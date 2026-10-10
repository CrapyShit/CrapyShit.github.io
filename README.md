# Jeff Kharrat portfolio

Character rigging and technical animation. Static site served by GitHub Pages.

- `index.html`: the whole site. Contact details, projects and media paths are in the `EDIT HERE` block near the bottom.
- The origin sequence (system, moon, data center, digital world, figure) plays behind the home page on load. `SITE.intro` in the same block sets it to `'always'`, `'once'` or `'off'`; its code is the `origin sequence` section of the script.
- `media/`: clips, images and CV files.
- `favicon.svg`, `favicon.ico`, `apple-touch-icon.png`: the tab and home-screen icon, the Yeff sigil. If you change them, raise the `?v=` number on the icon links in `index.html` so browsers fetch the new files.
