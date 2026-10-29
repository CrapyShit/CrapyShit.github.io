/* Flower head outline renderer (WebGL2), shared by the home intro and the lab page.
   The model (media/flower/flower-head.bin) is the JeffyFlower head from Maya, every vertex kept, plus the curves
   where its parts pass through each other, computed once offline.
   Drawn as outlines only: silhouettes, sharp creases and those intersection curves, with real hidden-line removal
   (a depth-only fill pass first), then a glitch pass (torn rows, block shifts, red/cyan split).

   FlowerGL.create(canvas, url) -> Promise of a renderer, or null when WebGL2 or the model is unavailable.
   renderer.frame({ items, w, h, dpr, cam, colours, mode, line, amb, burst, time, clipBottom })
     items: [{ p:[x,y,z], q:[x,y,z,w], s, snap, alpha, jit }], world units; the camera sits at (0,0,cam.z) looking down -z.
   renderer.project(p) -> [x, y] in CSS pixels for a world point (after frame() set the size).
   renderer.mouth: model-space points around the mouth and their centre, for aiming and for the mouth window. */
(function () {
'use strict';
const M = {};
M.qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
M.qax = (ax, an) => { const l = Math.hypot(ax[0], ax[1], ax[2]) || 1, s = Math.sin(an / 2); return [ax[0] / l * s, ax[1] / l * s, ax[2] / l * s, Math.cos(an / 2)]; };
M.qrot = (q, v) => { const x = q[0], y = q[1], z = q[2], w = q[3], cx = y * v[2] - z * v[1] + w * v[0], cy = z * v[0] - x * v[2] + w * v[1], cz = x * v[1] - y * v[0] + w * v[2];
  return [v[0] + 2 * (y * cz - z * cy), v[1] + 2 * (z * cx - x * cz), v[2] + 2 * (x * cy - y * cx)]; };
M.slerp = (a, b, k) => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3], bb = b;
  if (d < 0) { d = -d; bb = b.map(x => -x); }
  if (d > .9995) { const r = a.map((x, i) => x + (bb[i] - x) * k), l = Math.hypot(...r); return r.map(x => x / l); }
  const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - k) * th) / s, wb = Math.sin(k * th) / s;
  return a.map((x, i) => x * wa + bb[i] * wb);
};
M.rgb = h => { h = String(h).trim().replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&'); const n = parseInt(h, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
M.MAT = [[.889, .72, .522], [1, .92, .2], [1, .444, .115], [1, .173, .173], [1, .795, .179], [.2, .2, .2]];   // the Maya colours: head, yellow, orange, red, light orange, eyes

const INST = `
in vec3 iPos; in vec4 iRot; in vec4 iFx;   // iFx: scale, pixel snap, alpha, x jitter
uniform mat4 uVP; uniform vec3 uCam; uniform vec2 uRes;
vec3 qrot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
vec3 world(vec3 p) { return iPos + qrot(iRot, p * iFx.x); }
vec4 snap(vec4 c) {
  vec2 s = c.xy / c.w * uRes * .5;
  s.x += iFx.w;
  if (iFx.y > 1.0) s = floor(s / iFx.y + .5) * iFx.y;
  return vec4(s / (uRes * .5) * c.w, c.z, c.w);
}`;
const FILL_VS = `#version 300 es
in vec3 aP;` + INST + `
void main() { gl_Position = snap(uVP * vec4(world(aP), 1.0)); }`;
const FILL_FS = `#version 300 es
precision mediump float; out vec4 o; void main() { o = vec4(0); }`;
/* every edge as a screen-space quad; kind (aK.z): 0 plain, 1 crease, 2 intersection, 3 intersection on the face (eyes) */
const LINE_VS = `#version 300 es
in vec3 aA; in vec3 aB; in vec3 aN1; in vec3 aN2; in vec4 aK;` + INST + `
uniform float uW, uMode; uniform vec3 uInk, uAcc; uniform vec3 uMat[6];
out vec4 vC;
void main() {
  vec3 wa = world(aA), wb = world(aB);
  vec3 n1 = qrot(iRot, aN1), n2 = qrot(iRot, aN2), v = uCam - (wa + wb) * .5;
  bool always = aK.z > 1.5, face = aK.z > 2.5;
  bool f1 = dot(n1, v) > 0.0, f2 = dot(n2, v) > 0.0, sil = !always && f1 != f2, cr = !always && aK.z > .5 && (f1 || f2);
  if (!(sil || cr || always)) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = vec4(0); return; }
  vec4 ca = snap(uVP * vec4(wa, 1.0)), cb = snap(uVP * vec4(wb, 1.0));
  vec2 sa = ca.xy / ca.w * uRes * .5, sb = cb.xy / cb.w * uRes * .5, d = sb - sa;
  float l = length(d); d = l > 1e-4 ? d / l : vec2(1, 0);
  vec2 nr = vec2(-d.y, d.x);
  vec4 c = mix(ca, cb, aK.x);
  vec2 s = mix(sa, sb, aK.x) + nr * aK.y * uW * .5 + d * (aK.x * 2.0 - 1.0) * uW * .5;
  gl_Position = vec4(s / (uRes * .5) * c.w, c.z - .0006 * c.w, c.w);
  int m = int(aK.w + .5);
  vec3 col = uMode < .5 ? uInk : uMode < 1.5 ? uAcc : uMode < 2.5 ? ((cr && !sil) || face ? uAcc : uInk) : uMat[m];
  float far = clamp((uCam.z - 15.0 - iPos.z) / 9.0, 0.0, 1.0);
  float a = iFx.z * mix(1.0, .38, far);
  vC = vec4(col * a, a);
}`;
const LINE_FS = `#version 300 es
precision mediump float; in vec4 vC; out vec4 o; void main() { o = vC; }`;
/* uG: the constant glitch (0 none, 1 heavy), uB: a burst on top (0..1) */
const POST_VS = `#version 300 es
in vec2 aQ; out vec2 vU; void main() { vU = aQ * .5 + .5; gl_Position = vec4(aQ, 0, 1); }`;
const POST_FS = `#version 300 es
precision highp float;
in vec2 vU; out vec4 o;
uniform sampler2D uT; uniform vec2 uRes; uniform float uTime, uG, uB; uniform vec3 uA1, uA2;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = vU, px = 1.0 / uRes;
  float f = floor(uTime * 14.0), g = clamp(uG * .7 + uB, 0.0, 1.0);
  if (g <= 0.0) { o = texture(uT, uv); return; }
  float rows = mix(90.0, 26.0, uB), band = floor(uv.y * rows);
  if (h(vec2(band, f)) < g * .22) uv.x += (h(vec2(band, f + 7.0)) - .5) * (.02 + .03 * uG + .12 * uB);
  vec2 blk = floor(uv * vec2(18.0, 32.0));
  if (h(blk + f * 1.7) < g * .035) uv += (vec2(h(blk + 3.1), h(blk + 9.2)) - .5) * vec2(.12, .04);
  float sp = (1.0 + 4.0 * uG + 14.0 * uB) * px.x;
  vec4 c = texture(uT, uv);
  float ga = texture(uT, uv - vec2(sp, 0)).a, gb = texture(uT, uv + vec2(sp, 0)).a;
  float k = clamp(.6 * uG + uB, 0.0, 1.0);
  vec4 ghost = vec4(uA1 * ga + uA2 * gb, max(ga, gb)) * k * .85;
  o = c + ghost * (1.0 - c.a);
}`;

M.create = function (cv, url) {
  const gl = cv.getContext('webgl2', { antialias: false, premultipliedAlpha: true, alpha: true });
  if (!gl) return Promise.resolve(null);
  function sh(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function prog(vs, fs) { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); } return { p, u }; }
  function buf(data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, usage); return b; }
  let FILL, LINE, POST;
  try { FILL = prog(FILL_VS, FILL_FS); LINE = prog(LINE_VS, LINE_FS); POST = prog(POST_VS, POST_FS); } catch (e) { return Promise.resolve(null); }

  return fetch(url).then(r => (r.ok ? r.arrayBuffer() : Promise.reject(r.status))).then(ab => {
    const hd = new DataView(ab), nv = hd.getUint32(4, true), nf = hd.getUint32(8, true), ns = hd.getUint32(12, true);
    const o0 = 20, o1 = o0 + nv * 6, o2 = o1 + nf * 8, o3 = o2 + nf + ((o2 + nf) % 2);
    const q = new Int16Array(ab, o0, nv * 3), fc = new Uint16Array(ab, o1, nf * 4), mt = new Uint8Array(ab, o2, nf);
    const sq = new Int16Array(ab, o3, ns * 6), stg = new Uint8Array(ab, o3 + ns * 12, ns);
    const P = new Float32Array(nv * 3); for (let i = 0; i < nv * 3; i++) P[i] = q[i] / 32767;
    let R = 0; for (let i = 0; i < nv; i++) R = Math.max(R, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    const v = i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
    const N = new Float32Array(nf * 3);
    for (let f = 0; f < nf; f++) {
      const a = v(fc[f * 4]), b = v(fc[f * 4 + 1]), c = v(fc[f * 4 + 2]), d = v(fc[f * 4 + 3]);
      const x = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], y = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
      const n = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]], l = Math.hypot(n[0], n[1], n[2]) || 1;
      N.set([n[0] / l, n[1] / l, n[2] / l], f * 3);
    }
    const tri = new Uint16Array(nf * 6);
    for (let f = 0; f < nf; f++) tri.set([fc[f * 4], fc[f * 4 + 1], fc[f * 4 + 2], fc[f * 4], fc[f * 4 + 2], fc[f * 4 + 3]], f * 6);
    const MAXN = 64, instBuf = buf(new Float32Array(MAXN * 12), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW), inst = new Float32Array(MAXN * 12);
    const bindInst = p => {
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      [['iPos', 3, 0], ['iRot', 4, 3], ['iFx', 4, 7]].forEach(([n, s, o]) => {
        const l = gl.getAttribLocation(p, n); if (l < 0) return;
        gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, s, gl.FLOAT, false, 48, o * 4); gl.vertexAttribDivisor(l, 1);
      });
    };
    const VF = gl.createVertexArray(), VL = gl.createVertexArray(), VP = gl.createVertexArray();
    gl.bindVertexArray(VF);
    buf(P); { const l = gl.getAttribLocation(FILL.p, 'aP'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 3, gl.FLOAT, false, 0, 0); }
    buf(tri, gl.ELEMENT_ARRAY_BUFFER); bindInst(FILL.p);

    const E = new Map();
    for (let f = 0; f < nf; f++) for (let k = 0; k < 4; k++) {
      const a = fc[f * 4 + k], b = fc[f * 4 + (k + 1) % 4], key = a < b ? a * 65536 + b : b * 65536 + a, e = E.get(key);
      if (e) e.push(f); else E.set(key, [Math.min(a, b), Math.max(a, b), f]);
    }
    /* creases: only the sharp ones (mouth, the cleft and the ear tips); the head's soft bevels are left out */
    const COS = Math.cos(38 * Math.PI / 180), list = [...E.values()], edges = list.length + ns;
    const V4 = new Float32Array(edges * 64), I = new Uint32Array(edges * 6), mouth = [];
    list.forEach(([a, b, f1, f2 = f1], i) => {
      const n1 = [N[f1 * 3], N[f1 * 3 + 1], N[f1 * 3 + 2]], n2 = [N[f2 * 3], N[f2 * 3 + 1], N[f2 * 3 + 2]];
      const crease = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < COS ? 1 : 0, m = mt[f1], A = v(a), B = v(b);
      if (crease && m === 0) { const mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2; if (Math.abs(mx) < .3 && my > -.3 && my < .02) mouth.push(A, B); }
      [[0, -1], [0, 1], [1, -1], [1, 1]].forEach(([t, s], j) => V4.set([...A, ...B, ...n1, ...n2, t, s, crease, m], (i * 4 + j) * 16));
      const o = i * 4; I.set([o, o + 1, o + 2, o + 2, o + 1, o + 3], i * 6);
    });
    const sv = k => [sq[k] / 32767, sq[k + 1] / 32767, sq[k + 2] / 32767];
    for (let k = 0; k < ns; k++) {
      const i = list.length + k, a = sv(k * 6), b = sv(k * 6 + 3), kind = stg[k] === 2 ? 3 : 2, m = stg[k] === 2 ? 5 : stg[k] === 0 ? 0 : 2;
      [[0, -1], [0, 1], [1, -1], [1, 1]].forEach(([t, s], j) => V4.set([...a, ...b, 0, 0, 0, 0, 0, 0, t, s, kind, m], (i * 4 + j) * 16));
      const o = i * 4; I.set([o, o + 1, o + 2, o + 2, o + 1, o + 3], i * 6);
    }
    gl.bindVertexArray(VL);
    buf(V4);
    [['aA', 3, 0], ['aB', 3, 3], ['aN1', 3, 6], ['aN2', 3, 9], ['aK', 4, 12]].forEach(([n, s, o]) => {
      const l = gl.getAttribLocation(LINE.p, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, s, gl.FLOAT, false, 64, o * 4);
    });
    buf(I, gl.ELEMENT_ARRAY_BUFFER); bindInst(LINE.p);
    gl.bindVertexArray(VP);
    buf(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])); { const l = gl.getAttribLocation(POST.p, 'aQ'); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, 2, gl.FLOAT, false, 0, 0); }
    gl.bindVertexArray(null);
    const mc = mouth.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(x => x / Math.max(1, mouth.length));

    /* off-screen target: drawn with MSAA, resolved into a texture for the glitch pass */
    let W = 0, H = 0, msFbo = null, fbo = null, tex = null, rbs = [];
    function size(w, h) {
      if (w === W && h === H) return;
      W = cv.width = w; H = cv.height = h;
      if (tex) gl.deleteTexture(tex); rbs.forEach(r => gl.deleteRenderbuffer(r)); [fbo, msFbo].forEach(f => f && gl.deleteFramebuffer(f));
      const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES));
      msFbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
      const c = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, c); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, c);
      const d = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, d); gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, d); rbs = [c, d];
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR));
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
      fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    let vp = new Float32Array(16), cssW = 1, cssH = 1;
    function camera(c) {
      const t = Math.tan((c.fov || 32) * Math.PI / 360), f = 1 / t, n = c.near || 4, fr = c.far || 40, m = new Float32Array(16);
      m[0] = f / (W / H); m[5] = f; m[10] = (fr + n) / (n - fr); m[11] = -1; m[14] = m[10] * -c.z + 2 * fr * n / (n - fr); m[15] = c.z;
      return m;
    }
    const api = {
      radius: R, mouth: { pts: mouth, centre: mc }, maxItems: MAXN,
      clear() { if (W) { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } },
      project(p) {                                                       // world point -> CSS pixels on this canvas
        const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12], y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13], w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
        return [(x / w * .5 + .5) * cssW, (.5 - y / w * .5) * cssH, w];
      },
      unproject(sx, sy, z, camZ) {                                     // CSS pixel + world depth -> world point (the camera looks straight down -z)
        const nx = sx / cssW * 2 - 1, ny = 1 - sy / cssH * 2, d = camZ - z;
        return [nx * d / vp[0], ny * d / vp[5], z];
      },
      frame(o) {
        const dpr = o.dpr || 1, w = Math.max(1, Math.round(o.w * dpr)), h = Math.max(1, Math.round(o.h * dpr));
        size(w, h); cssW = o.w; cssH = o.h;
        vp = camera(o.cam);
        const items = o.items.slice(0, MAXN), n = items.length;
        items.forEach((d, i) => inst.set([d.p[0], d.p[1], d.p[2], d.q[0], d.q[1], d.q[2], d.q[3], d.s, (d.snap || 0) * dpr, d.alpha == null ? 1 : d.alpha, (d.jit || 0) * dpr, 0], i * 12));
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * 12);
        const C = o.colours, cam = [0, 0, o.cam.z];
        gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo); gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        if (n) {
          gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
          [FILL, LINE].forEach(Q => { gl.useProgram(Q.p); gl.uniformMatrix4fv(Q.u.uVP, false, vp); gl.uniform3fv(Q.u.uCam, cam); gl.uniform2f(Q.u.uRes, W, H); });
          gl.useProgram(FILL.p); gl.colorMask(false, false, false, false);
          gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2);
          gl.bindVertexArray(VF); gl.drawElementsInstanced(gl.TRIANGLES, tri.length, gl.UNSIGNED_SHORT, 0, n);
          gl.disable(gl.POLYGON_OFFSET_FILL); gl.colorMask(true, true, true, true);
          gl.useProgram(LINE.p);
          gl.uniform1f(LINE.u.uW, (o.line || 1.4) * dpr); gl.uniform1f(LINE.u.uMode, o.mode == null ? 2 : o.mode);
          gl.uniform3fv(LINE.u.uInk, C.ink); gl.uniform3fv(LINE.u.uAcc, C.acc);
          gl.uniform3fv(LINE.u.uMat, new Float32Array(M.MAT.map((c, i) => (i === 5 ? C.ink : c)).flat()));
          gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
          gl.bindVertexArray(VL); gl.drawElementsInstanced(gl.TRIANGLES, edges * 6, gl.UNSIGNED_INT, 0, n);
          gl.depthMask(true); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msFbo); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
        const cb = o.clipBottom == null ? H : Math.max(0, Math.round(o.clipBottom * dpr));   // nothing below this line (CSS px from the top)
        gl.enable(gl.SCISSOR_TEST); gl.scissor(0, H - cb, W, cb);
        gl.useProgram(POST.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(POST.u.uT, 0); gl.uniform2f(POST.u.uRes, W, H); gl.uniform1f(POST.u.uTime, o.time || 0);
        gl.uniform1f(POST.u.uG, o.amb || 0); gl.uniform1f(POST.u.uB, o.burst || 0);
        gl.uniform3fv(POST.u.uA1, C.glA); gl.uniform3fv(POST.u.uA2, C.glB);
        gl.bindVertexArray(VP); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
        gl.disable(gl.SCISSOR_TEST);
      }
    };
    return api;
  }).catch(() => null);
};
window.FlowerGL = M;
})();
