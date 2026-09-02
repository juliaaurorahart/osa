# Working section trial

Notebook → **Upside-down notebook** opens one working section per notebook. The existing Library remains available.

- In **Cells**, new text, workspaces, code, images/files, and reused notebook objects appear **at the top**. In **Page**, new text appears immediately after the open object, or at the top when nothing is open; the chronological order of everything else stays intact. The add controls stay visible while scrolling, and new text/code editors receive focus.
- **+ Workspace** offers Ink, Klecks, Excalidraw, draw.io, Mermaid, and Vega-Lite. Editable native files are created first, with a clearly labeled placeholder until the first visual Save. Imported files for unsupported inline tools still open in their workbenches.
- **Hide top bar** collapses Lab navigation without closing an editor. **Show Lab bar** restores it; saving errors remain visible.
- Only one cell is editable. **In place**, **Split**, and **Focus** rearrange the same mounted editor, preserving its current state.
- New code starts with an adjustable animated ribbon example. Connect p5, then choose **Run with p5**. Code stays above its output and they move together. **+ Example cell** creates a new connected example at the top without replacing existing code. Leaving the section stops execution; nothing runs automatically.
- Text autosaves. Editable workspaces use the existing recovery-draft mechanism; **Save** updates their live notebook file. Most editors resume the working draft, including invalid Mermaid text and unapplied Vega edits. draw.io and Klecks instead show Saved first, with explicit Saved/Draft editing as described below. Library opening keeps its existing live/draft preference.
- Switching cells or leaving the section awaits its queued saves. Failure retains the editor; an in-flight image capture cannot save into another cell. Saved files and drafts remain subject to the existing notebook sync status.
- Removing a cell removes its reference, not the underlying object or history.
- Konva, Paper, and other tools remain preview/open-in-workbench objects in this trial. Native draft preflight finishes before an editor replaces the current one, and draft callbacks are bound to their originating cell session.

## draw.io Saved / Draft trial

draw.io section cells show the **Saved** preview, without loading a remote editor. **Edit Saved** and **Continue Draft** choose the editing source explicitly. Opening requires consent to send that diagram to `embed.diagrams.net`; starting from Saved also asks before replacing a different working draft. An editor that never loads can be closed without changing either version.

While editing, XML autosaves to the existing single draft slot. **Close editor** commits any in-place label and requests a correlated raw XML export, then awaits local notebook persistence before returning to the Saved preview. Blank diagrams do not require an image export to close. Failed captures or writes retain the editor, and stale responses cannot overwrite newer drafts. Navigation, notebook switching and theme changes wait for Close; layout modes and hiding the top bar keep the same iframe. Browser/tab departure still warns, but abrupt shutdown can lose changes since the last successful autosave.

**Push to notebook** separately captures a picture plus editable XML and updates the same Saved object. The draft remains available even when it matches Saved (`draftActive=false` means no unpublished changes, not deletion). A newer draft arriving during a Push is preserved. Close never publishes. Existing full-workbench behavior and other editors are unchanged.

draw.io picture previews now export as 2× PNGs for clearer notebook display, in both section and full-workbench saves. Existing previews keep their original resolution until the diagram is opened and pushed/saved again. Editable XML, draft checkpoints and the notebook file-size limit are unchanged.

The notebook's sync indicator remains authoritative for cross-device availability: a local draft acknowledgement does not claim that cloud upload has finished. This uses the [official draw.io embed protocol](https://www.drawio.com/docs/reference/embed-mode/) (`autosave`, `resetEditor`, `export`, correlated messages); no iframe DOM access is needed.

## Klecks Saved / Draft editing

Klecks uses the same Saved preview → **Edit Saved** / **Continue Draft** → **Close editor** flow. It runs in a self-hosted iframe, not an external painting service. It keeps its own layers, brushes and editing tools in all three section layouts; only one editor is mounted. **From notebook** can reuse an existing painting in a section.

New cells start from a real 1200×900 PSD with an opaque black Canvas background layer and a transparent Drawing layer. The blank file is generated and fully decoded by `scripts/generate-klecks-starter.mjs` using the already-pinned PSD codec. Only that named starter gets a light initial brush; existing/imported painting pixels are never recolored.

Draft autosaves and Close preserve the layered PSD; **Push to notebook** updates the same Saved object with paired PNG and PSD files. Native **Submit** saves Draft only inside a section; standalone workbench Submit keeps its existing Save behavior. PSD preserves editable raster layers, not the painter's undo/stroke history. Open/New host resets are omitted during section editing; start another cell or close this editor first.

Close first checks that no brush stroke, native dialog, selection transform or export is pending, then waits for a fresh PSD checkpoint and local durability. It never needs a PNG to close. Pending text/filter/transform previews must be applied or canceled in the painter before saving/closing; failures leave the editor open and interactive. This guard uses reviewed DOM markers in the pinned self-hosted bridge, checked by `test:klecks`; review them when upgrading Klecks. Failed initial restoration cannot overwrite an older draft. Background autosave reduces loss, but an abrupt shutdown can still lose changes since the last successful checkpoint. Cloud availability remains governed by the notebook sync indicator.

## Continue a painting in Konva

On a Klecks cell, **Push to notebook → Close editor → Continue in Konva** starts a separate Konva project from the Saved PNG. The same action is in the library's file actions/preview and the standalone Klecks **File** menu. New placeholders cannot be handed off until a painting has been pushed. Draft-only changes are not included.

The layered PSD, original Saved version, and Klecks draft stay untouched. Konva receives one movable image at its native dimensions, with the original topics and a link back to the painting. A handoff from a section adds the new object at the top. The destination is saved before opening, then uses normal Konva drafts and Save; subsequent saves update this new project. **Open original** returns to the original project, not a live-linked copy. Editing one does not automatically change the other.

The PNG is embedded in Konva's native file, kept in the existing file store rather than the notebook database JSON. The notebook records the source object and exact immutable Saved file as provenance, including a `derived-from` edge; backups and independent notebook copies preserve/remap these links. No new schema or dependency is needed. Combined native file + preview remains limited to 25 MB. Handoffs accept PNGs up to 4096 pixels per edge.

Konva fits a restored painting without resizing its stored pixels. Its PNG preview/download includes the full visible artwork, not the current viewport, and omits the grid and selection handles. Transparency, rotated objects and eraser compositing are retained; exports are bounded to 4096 pixels per edge. Finish an active stroke/move and let images load before saving. This first handoff opens the existing full Konva workbench, not another inline editor or a mixed canvas.

## Data

A section is an ordinary OSA v7 graph node with `lab:role=section`. `lab:cells` stores a versioned ordered list of stable cell IDs and object references. An optional `workspace: p5` belongs to the code cell; it does not duplicate code or introduce another draft writer. Section topics use the existing topic relationships. Object contents and immutable file bytes remain in the established notebook stores, outbox, and private file storage.

No database migration or new dependency is required. Existing metadata, topic links, file revisions, backups and unrelated graph fields are preserved. Unknown section formats are not rewritten.

## Checks

`npm run test:section` exercises the isolated section lifecycle, binary Klecks Saved/Draft round trips, and real Ink checkpointing. `npm run test:klecks` fully decodes the starter layers and checks the host/bridge protocol, pending-operation guards, safe-close preflight, native Submit semantics, trust boundaries and cleanup. The notebook cloud/scope checks cover graph round trips, portable backups, ID remapping, guarded atomic actions, and failed durability acknowledgements. `npm run test:code` checks explicit execution, connected workspace creation, and stop-on-leave behavior. No tests write to user notebooks.

`npm run test:handoff` checks real PNG conversion and Konva rendering in memory: native dimensions, transparent pixels, distant coordinates, rotated bounds, erasers and bounded exports. The scope/navigation/section checks also exercise source-version races, delayed or failed persistence, duplicate activation, source-preview recovery and explicit Saved initialization.
