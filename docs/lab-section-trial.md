# Working section trial

Notebook → **Upside-down notebook** opens one working section per notebook. The existing Library remains available.

- New text, workspaces, code, images/files, and reused notebook objects appear **at the top**. Existing cell order stays intact. The add controls stay visible while scrolling; new text/code editors receive focus.
- **+ Workspace** offers Ink, Excalidraw, draw.io, Mermaid, and Vega-Lite. Editable native files are created first, with a clearly labeled placeholder until the first visual Save. Imported files for unsupported inline tools still open in their workbenches.
- **Hide top bar** collapses Lab navigation without closing an editor. **Show Lab bar** restores it; saving errors remain visible.
- Only one cell is editable. **In place**, **Split**, and **Focus** rearrange the same mounted editor, preserving its current state.
- New code starts with an adjustable animated ribbon example. Connect p5, then choose **Run with p5**. Code stays above its output and they move together. **+ Example cell** creates a new connected example at the top without replacing existing code. Leaving the section stops execution; nothing runs automatically.
- Text autosaves. Editable workspaces use the existing recovery-draft mechanism; **Save** updates their live notebook file. Section editing resumes the working draft, including invalid Mermaid text and unapplied Vega edits. Library opening keeps its existing live/draft preference.
- Switching cells or leaving the section awaits its queued saves. Failure retains the editor; an in-flight image capture cannot save into another cell. Saved files and drafts remain subject to the existing notebook sync status.
- Removing a cell removes its reference, not the underlying object or history.
- Konva, Paper, and other tools remain preview/open-in-workbench objects in this trial. Native draft preflight finishes before an editor replaces the current one, and draft callbacks are bound to their originating cell session.

## draw.io Saved / Draft trial

draw.io section cells show the **Saved** preview, without loading a remote editor. **Edit Saved** and **Continue Draft** choose the editing source explicitly. Opening requires consent to send that diagram to `embed.diagrams.net`; starting from Saved also asks before replacing a different working draft. An editor that never loads can be closed without changing either version.

While editing, XML autosaves to the existing single draft slot. **Close editor** commits any in-place label and requests a correlated raw XML export, then awaits local notebook persistence before returning to the Saved preview. Blank diagrams do not require an image export to close. Failed captures or writes retain the editor, and stale responses cannot overwrite newer drafts. Navigation, notebook switching and theme changes wait for Close; layout modes and hiding the top bar keep the same iframe. Browser/tab departure still warns, but abrupt shutdown can lose changes since the last successful autosave.

**Push to notebook** separately captures a picture plus editable XML and updates the same Saved object. The draft remains available even when it matches Saved (`draftActive=false` means no unpublished changes, not deletion). A newer draft arriving during a Push is preserved. Close never publishes. Existing full-workbench behavior and other editors are unchanged.

The notebook's sync indicator remains authoritative for cross-device availability: a local draft acknowledgement does not claim that cloud upload has finished. This uses the [official draw.io embed protocol](https://www.drawio.com/docs/reference/embed-mode/) (`autosave`, `resetEditor`, `export`, correlated messages); no iframe DOM access is needed.

## Data

A section is an ordinary OSA v7 graph node with `lab:role=section`. `lab:cells` stores a versioned ordered list of stable cell IDs and object references. An optional `workspace: p5` belongs to the code cell; it does not duplicate code or introduce another draft writer. Section topics use the existing topic relationships. Object contents and immutable file bytes remain in the established notebook stores, outbox, and private file storage.

No database migration or new dependency is required. Existing metadata, topic links, file revisions, backups and unrelated graph fields are preserved. Unknown section formats are not rewritten.

## Checks

`npm run test:section` exercises the isolated section lifecycle and real Ink checkpointing. The notebook cloud/scope checks cover graph round trips, portable backups, ID remapping, guarded atomic actions, and failed durability acknowledgements. `npm run test:code` checks explicit execution, connected workspace creation, and stop-on-leave behavior. No tests write to user notebooks.
