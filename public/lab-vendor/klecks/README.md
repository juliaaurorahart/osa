# Self-hosted Klecks painter

Upstream: https://github.com/bitbof/klecks

Pinned revision: `6df305c2b16d14221fcc01df6f7e1885f0aaac3e` (2026-08-23).
Klecks is created by developer/artist bitbof and released under the MIT license.
The Kleki name/brand is not included in the Klecks license. OSA calls this tool
Klecks and does not represent it as Kleki.

`upstream/` contains the map-free official embed build with one documented OSA
initializer patch (`scripts/klecks-initial-brush-color.patch`), including
all lazy chunks, fonts, images, help, and in-app license dialogs. Runtime assets
are approximately 2.04 MiB before compression. They load only when this iframe
is opened; no desktop application or remote painting service is involved.

The adjacent `index.html` and `bridge.js` are OSA integration code. They keep the
upstream singleton in its own document and exchange explicit PNG/PSD captures
with the same-origin parent. Artwork is not sent to Kleki or any other external
service. A content-security policy restricts networking to this origin.

New OSA painting pages default to a black canvas-background layer beneath a
transparent Drawing layer. The outer New canvas selector affects only the next
New painting action, not the open document. Imported PSDs bypass these defaults
and keep all of their existing layers/colors. Background layers are real image
content in PNG/PSD exports, not a dark CSS overlay; the native Layers panel can
edit or hide them. The initializer patch adds an optional `initialBrushColor`
parameter through the embed into the app's existing brush/color-picker startup.
OSA supplies warm-white only for fresh Black/Charcoal canvases. Light/transparent
new pages retain the upstream black brush; imported PSDs receive no override.
The patch never changes layer pixels or saved brush marks.

Reproduce with `node scripts/vendor-klecks.mjs` from the project root. This
downloads the pinned archive into a temporary directory and runs upstream's
locked dependency install, icon generation, language generation, initializer patch, and Parcel
embed build. It refuses to overwrite an existing `upstream/` directory. No
upstream build dependencies are added to OSA's package.json.

Preserved notices:

- `upstream/LICENSE.txt`: upstream application license.
- `upstream/FONT-LICENSES.txt`: full upstream font-license source text.
- `upstream/UPSTREAM-THIRD-PARTY-LICENSES.txt`: full upstream library notices.
- `upstream/DEPENDENCY-LICENSES.txt`: notices from the locked build dependencies.
- `upstream/build-manifest.json`: source revision and artifact SHA-256 hashes.
- `upstream/OSA-INITIAL-BRUSH-COLOR.patch`: exact source modification, also hashed
  in the build manifest. All upstream licenses and authorship remain intact.

Editable source is a layered PSD, not a vector stroke history. PSD compatibility
has the limits of Klecks/ag-psd; keep the original file when opening other apps'
PSD documents. The pinned source's `readPSD` type says Blob, but its implementation
forwards directly to ag-psd; the bridge passes an ArrayBuffer, matching upstream's
working embed example and ag-psd's actual input API.

Notebook cells reuse this iframe with explicit Saved/Draft selection. The host
waits for a native PSD draft before closing and publishes PNG+PSD only on Push.
Native Submit checkpoints Draft inside a section; the full workbench retains its
existing Submit behavior. Unapplied native dialogs and selection transforms block
exports so their temporary pixels cannot be silently omitted. The bridge guards
`.kl-popup` and `select[name="move-to-layer"]`, as reviewed in this pinned build;
review those markers when upgrading. A fast Close preflight avoids waiting behind
a background checkpoint while an unfinished pointer gesture is still active.

`new-painting.psd` is the OSA notebook's native blank starter, not upstream artwork.
Reproduce it with `node scripts/generate-klecks-starter.mjs`; `--check` validates
without writing. The generator uses the pinned ag-psd bundle offline and verifies
the black composite, Canvas background and transparent Drawing layer. The host
does not ship an additional PSD writer. `npm run test:klecks` covers the starter,
protocol, pending-edit guards and managed Submit/Close behavior.
