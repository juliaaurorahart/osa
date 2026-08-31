# Working section trial

Notebook → **Upside-down notebook** opens one working section per notebook. The existing Library remains available.

- New text, workspaces, code, images/files, and reused notebook objects appear **at the top**. Existing cell order stays intact. The add controls stay visible while scrolling; new text/code editors receive focus.
- **+ Workspace** offers Ink, Excalidraw, Mermaid, and Vega-Lite. Editable native files are created first, with a clearly labeled placeholder until the first visual Save. Imported files for unsupported inline tools still open in their workbenches.
- **Hide top bar** collapses Lab navigation without closing an editor. **Show Lab bar** restores it; saving errors remain visible.
- Only one cell is editable. **In place**, **Split**, and **Focus** rearrange the same mounted editor, preserving its current state.
- New code starts with an adjustable animated ribbon example. Connect p5, then choose **Run with p5**. Code stays above its output and they move together. **+ Example cell** creates a new connected example at the top without replacing existing code. Leaving the section stops execution; nothing runs automatically.
- Text autosaves. Editable workspaces use the existing recovery-draft mechanism; **Save** updates their live notebook file. Section editing resumes the working draft, including invalid Mermaid text and unapplied Vega edits. Library opening keeps its existing live/draft preference.
- Switching cells or leaving the section awaits its queued saves. Failure retains the editor; an in-flight image capture cannot save into another cell. Saved files and drafts remain subject to the existing notebook sync status.
- Removing a cell removes its reference, not the underlying object or history.
- draw.io, Konva, Paper, and other tools remain preview/open-in-workbench objects in this trial. Native draft preflight finishes before an editor replaces the current one, and draft callbacks are bound to their originating cell session.

## Data

A section is an ordinary OSA v7 graph node with `lab:role=section`. `lab:cells` stores a versioned ordered list of stable cell IDs and object references. An optional `workspace: p5` belongs to the code cell; it does not duplicate code or introduce another draft writer. Section topics use the existing topic relationships. Object contents and immutable file bytes remain in the established notebook stores, outbox, and private file storage.

No database migration or new dependency is required. Existing metadata, topic links, file revisions, backups and unrelated graph fields are preserved. Unknown section formats are not rewritten.

## Checks

`npm run test:section` exercises the isolated section lifecycle and real Ink checkpointing. The notebook cloud/scope checks cover graph round trips, portable backups, ID remapping, guarded atomic actions, and failed durability acknowledgements. `npm run test:code` checks explicit execution, connected workspace creation, and stop-on-leave behavior. No tests write to user notebooks.
