# Working section trial

Notebook → **Section · try it** opens one working section per notebook. The existing Library remains available.

- Add text, an Ink drawing, code, an image/file, or reuse a notebook object. New cells go after the selected cell; new text/code editors receive focus.
- Only one cell is editable. **In place**, **Split**, and **Focus** rearrange the same mounted editor, preserving its current state.
- A code cell can add a connected p5 workspace. Code and output move together; code executes only after **Run with p5**. Leaving the section stops execution.
- Text autosaves. Ink/code use the existing recovery-draft mechanism; **Save** updates their live notebook file. Section editing resumes the working draft. Library opening keeps its existing live/draft preference.
- Switching cells or leaving the section awaits its queued saves. Failure retains the editor; an in-flight image capture cannot save into another cell. Saved files and drafts remain subject to the existing notebook sync status.
- Removing a cell removes its reference, not the underlying object or history.
- draw.io and other tools are previewed here and open in their existing workbenches. They are not additional inline editors in this trial.

## Data

A section is an ordinary OSA v7 graph node with `lab:role=section`. `lab:cells` stores a versioned ordered list of stable cell IDs and object references. An optional `workspace: p5` belongs to the code cell; it does not duplicate code or introduce another draft writer. Section topics use the existing topic relationships. Object contents and immutable file bytes remain in the established notebook stores, outbox, and private file storage.

No database migration or new dependency is required. Existing metadata, topic links, file revisions, backups and unrelated graph fields are preserved. Unknown section formats are not rewritten.

## Checks

`npm run test:section` exercises the isolated section lifecycle and real Ink checkpointing. The notebook cloud/scope checks cover graph round trips, portable backups, ID remapping, guarded atomic actions, and failed durability acknowledgements. `npm run test:code` checks explicit execution, connected workspace creation, and stop-on-leave behavior. No tests write to user notebooks.
