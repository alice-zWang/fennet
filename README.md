# Fennet

A free note-taking web app for handwriting, PDF annotation, audio recordings and study tools.
Notes are stored only in your own browser on your own device; there are no accounts, servers or trackers.

**Open the app:** https://alice-zwang.github.io/fennet/

## Demo (sample notes, nothing saved)

The demo uses separate storage and resets on every visit, so it never touches anyone's real notes.

| Screen | Link |
|---|---|
| Library, dark | https://alice-zwang.github.io/fennet/?demo |
| Library, light | https://alice-zwang.github.io/fennet/?demo&theme=light |
| Note with handwriting, diagram and highlights | https://alice-zwang.github.io/fennet/?demo&note=1 |
| Same note, light mode | https://alice-zwang.github.io/fennet/?demo&note=1&theme=light |
| Note with the Learn panel open | https://alice-zwang.github.io/fennet/?demo&note=1&panel=learn |
| Note with the Outline panel open | https://alice-zwang.github.io/fennet/?demo&note=2&panel=outline |
| Lecture note (lined paper) | https://alice-zwang.github.io/fennet/?demo&note=4&theme=light |
| Settings | https://alice-zwang.github.io/fennet/?demo&settings=1 |
| Mint accent color instead of lime | https://alice-zwang.github.io/fennet/?demo&accent=4ee6c8 |
| Welcome tour | https://alice-zwang.github.io/fennet/?demo&intro |
| Water-bubble style sampler | https://alice-zwang.github.io/fennet/design/bubble.html |
| Mascot designs | https://alice-zwang.github.io/fennet/design/mascots.html |

Options combine with `&`: `theme=light|dark|system`, `accent=<hex>`, `note=1..5`, `panel=learn|outline|study|find|history`, `settings=1`, `intro`.

The library cover (tap the picture button on the big card) can be fractal art, a color, a gradient, or your own image or PDF page.

Privacy policy: [docs/privacy-policy.md](docs/privacy-policy.md). Bundled open-source parts are in `vendor/`
(PDF.js, jsPDF, Tesseract.js, Mammoth, JSZip) and `fonts/` (SIL Open Font License), with their licenses.
