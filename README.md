# OSA

OSA is a durable connected-object Space for writing, sketching, actions, projects, and assembly work.

Nodes, connections, text, and properties are the shared data model. Actions,
Projects, Assembly, and Space are views over the open board. The Lab notebook
uses the same OSA graph primitives in a separate document: saving a Lab note
or file does not insert it into the current project or Assembly.

## Where a board is saved

- New and imported boards begin on this device. Editing or signing in alone does not upload them: choose **Settings → Sync to my account** to start cloud storage.
- OSA keeps browser recovery drafts, separated into guest/account scopes. These are not cross-device backups, and clearing browser data can remove them.
- Once a board is synced or loaded from the cloud, edits autosave to its revision-checked D1 record through `/api/boards`. The configured database binding is `OSA_DB`.
- Cloud board JSON holds file references; private file bytes live separately in the R2 bucket bound as `OSA_ASSETS`. A file inherits its owning board's permissions.
- **Download JSON backup** embeds accessible OSA-managed files in the downloaded JSON. This portable copy is different from raw cloud JSON, which still contains file URLs. An unavailable file produces an export error instead of a silently incomplete backup. Arbitrary external web links are not archived.
- Plain `npm run dev` runs Vite without Cloudflare APIs and stays local. It does not proxy writes to production.

Cloudflare Access verifies the signed-in email. Boards have an owner and may
have named editors or viewers; being signed in does not grant access to every
board. A public Assembly link is a separate, intentional anyone-with-the-link
publication, not a private invitation. Public links receive only their scoped
Assembly data and eligible files. Bare legacy `/media/...` links are no longer
public file credentials in this implementation.

On 2026-08-30, migrations **0007 and 0008** were applied after complete
database and file backups. An independent post-migration export verified that
the existing board, share, and collaborator records were unchanged and the
historical file grants matched the rehearsal. See
[Private storage and deployment](docs/private-storage-deployment.md) and the
[Lab address rollout](docs/lab-domain-rollout.md) for the remaining live checks.

## Import the Shako source data

`imports/shako-light-wrap.osa.json` is a one-time bridge from the existing
assembly-instruction PowerPoint and BOM/expense workbook. Use **Import OSA
Data** and choose that JSON file. The validated package adds ordinary nodes and
edges to the current board, opens its Space, and shows its Assembly board. Use
the deployed site and choose **Sync to my account** when the imported
information should sync; subsequent edits then autosave.

The Assembly view recognizes ordinary Projects connected to ordinary Actions,
so an import does not need special assembly node classes. Each Action becomes
an editable visual instruction card and keeps using its linked Parts, Tools,
text, properties, and sketches. Re-importing the same package does not
overwrite later edits or create duplicate objects.

The source-specific converter is `scripts/create-shako-import.py`. It reads the
two Office files without modifying them and uses only Python's standard
library.

## Inspect or export the D1 data

In the Cloudflare dashboard, open the OSA Pages project and inspect **Settings → Bindings** to see which D1 database is attached as `OSA_DB`. In that database's console, this query lists the saved boards without printing their full content:

```sql
SELECT id, owner_email, name, updated_at, length(content) AS content_bytes
FROM boards
ORDER BY updated_at DESC;
```

The board document is JSON in `content`; that database export does **not**
include R2 file bytes or unsynced browser drafts. Back up those separately.
After confirming the actual database and signing into the correct Cloudflare
account, a database-only backup can be made with Wrangler. Choose a new,
private dated directory **outside this repository** for the output:

```sh
npx wrangler d1 export <database-name> --remote --output=<private-backup-directory>/osa-backup.sql
```

The repository intentionally does not contain a D1 database ID, so the deployed `OSA_DB` binding in Cloudflare is the source of truth for which database receives saves.

See [Development data and recovery](docs/development-data-recovery.md) for
test-data isolation, complete backup contents, and restore checks.

Cloudflare references: [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [D1 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/), and [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Visual tools Lab

The app supports a dedicated Lab front door at
`https://lab.juliaaurorahart.com/`, using the same deployment and account
notebook as OSA. Hosting setup is tracked separately in the
[Lab address rollout checklist](docs/lab-domain-rollout.md); source support
does not mean the address has been activated. The old
`https://osa.juliaaurorahart.com/?lab=canvas` route stays available, especially
for browser-only files that have not been synced or backed up.

The **Lab** menu opens isolated visual workbenches. Each engine loads only
when selected. New note ideas and the reopenable editors below keep
automatic recovery drafts. Use **Notebook → Drafts** to resume work.
Each project has one current draft slot, separate from its explicit saved version.
Saved notebook notes, files, and topics persist independently of project
boards. Original editable files and their previews are separate attachments.

The notebook picker switches deliberately named datasets. **New notebook**
requires a name and starts empty, either on this device or in the signed-in
private account. **Rename** changes only the name, keeping file/draft/topic
identities. Switching flushes supported editor drafts before closing the old
editor. Each notebook has its own local cache/outbox; inactive unsynced changes
are retained and sync when that notebook is reopened. Sign-in and sync/backups
remain in the notebook. External OSA Draw captures still go to the default
notebook; viewing another notebook does not silently redirect them.

Named account notebooks require additive migration `0009_lab_notebook_catalog.sql`.
The catalog keeps their names independent of older clients' hardcoded titles,
while the legacy default mapping and OSA board JSON schema remain unchanged.

Workbenches share a compact bar: Lab, tool, project name, draft status,
**Save**, Notebook, Focus, and File. **File** holds Save a copy, available
downloads, New project, and settings; the status disclosure holds version
switching and sync details. Storage failures remain visible outside menus.
**Focus** hides secondary navigation without closing or restarting the editor.

For an editable project, set **Project name**, then use the shared
**Save** (draw.io's **Save** and Klecks' **Submit** also save
there). Saving updates the current notebook file; **Save a copy** creates a
separate item. Earlier saves remain available in **History**, with immutable
source and preview bytes for each saved version.
Notebook visits keep the current editor mounted; **Return to [tool]** resumes
it. **Saved · read only / Working draft** switches between the last deliberate
save and current work without discarding either. Replacing the editor or leaving
the Lab flushes supported drafts first. Save only consumes the exact checkpoint
included in that save; newer edits remain drafts. Already-added text notes keep
their existing automatic-save behavior.

Drafts checkpoint locally as you work (frequent events coalesce over 400 ms),
and participate in private account sync and portable backups. Klecks saves
source-only PSD checkpoints after interaction and an idle safety check; no PNG
preview is generated for autosave. The local draft status is separate from
account-sync status. A sudden shutdown can still lose edits since the last
completed checkpoint, and browser storage is not a backup. Export important work.
Fabric, Pixi, Three, and remote Strudel do not yet expose a
complete reopenable draft path here; their workbenches explicitly say to use
Save/export/Share before leaving. Draft checkpoints use the existing notebook graph format.

Notebook browsing/search and focused note editing are separate views. Files
can be moved to **Trash** and restored; removing a file does not permanently
delete its saved bytes or history. The browser uses a mixed column-card view,
with an optional **Table** that exposes topic checkboxes beside each item.
Independent filters select topics (**All**, **None / untagged**, or a topic),
types/tools, and **Live**, **Live and draft**, **Draft only**, or **Trash**.
History stays inside each file's **More** menu, not in the live/draft list.
Draft-only native sources do not display a misleading saved-image preview.
Newly added notes return to the Live view. Topic edits survive note autosave
and promotion; a saved project and its working draft share topic memberships,
including a never-saved draft's first Save. No database migration is needed.

Click **Open**, or filter to **Editable projects**. In **Lab Settings → Opening
notebook projects**, choose which version opens for a live item. The default
is **Live · saved version**; **Working draft · when available** resumes recovery
work instead. Clicking a draft always opens that draft. When another working
draft exists, the saved view remains read-only so opening it cannot overwrite
that draft. Both this preference and Cards/Table presentation are device-local.
Supported native files currently include Ink,
Klecks PSD, draw.io, Excalidraw, Konva Lab, Paper, Mermaid, Vega-Lite, p5, and CodeMirror.
Preview images cannot restore layers or editable shapes. Other exports remain
downloadable; Pixi/Three/OSA Draw restoration is
not implemented here. Opening draw.io requires confirmation because its
editor is hosted at `embed.diagrams.net`, outside OSA. Saved native files are
validated before opening; Klecks additionally parses PSD layers inside its
local iframe. Imported Paper geometry is kept paused rather than regenerated.

The p5 workbench offers preset controls and a JavaScript editor. Native
`.osa-p5.json` files retain controls, artwork theme, edited source, and the last
run source; old p5 `.js` exports also open in the editor. Opening saved code or
a recovery draft never executes it. **Run code** flushes drafts, then starts an
opaque `allow-scripts` iframe with a bundled p5 runtime. The frame receives no
notebook data and exposes only status/errors and requested PNG captures.
Remote scripts/files, nested frames, and camera/microphone access are disabled.
This is not a CPU sandbox: endless loops can freeze the tab, and iframe
self-navigation is not prevented by CSP. Only run trusted code. **Stop** destroys
the frame. Run is limited to 250,000 characters; larger unrun text remains
recoverable within the existing 25 MB notebook file limit. Preview/export is a
still PNG, not a recorded animation. Raw JavaScript export is available separately.

New Ink pages are transparent; their display-only checkerboard follows the Lab
theme and is not baked into exported images. Existing artwork keeps its chosen
background. Klecks and remote Strudel retain their editors' independent themes.

**CodeMirror** saves independent code projects with a p5 result card beside the
editor. **Run with p5** explicitly checkpoints a draft before sending a plain
JavaScript snapshot to the same stopped-by-default p5 runner described above.
Edits do not rerun it. TypeScript, Python, shell scripts, and text are edit/save
only; there is no Python or shell execution, module import, notebook-data access,
or general card wiring. **Save** preserves source without needing a successful
run or an image. Empty and unfinished code is valid in the `.osa-code.json`
envelope, which retains filename, language, and exact text. Recovery drafts,
topics, saved history, trash, and account sync use the existing notebook paths.
Use Notebook **Add files** to import code projects or `.js`, `.mjs`, `.cjs`,
`.jsx`, `.ts`, `.tsx`, `.py`, `.sh`, `.bash`, `.zsh`, `.txt`, `.bashrc`, and `.zshrc`
files. JSX/TypeScript are not transpiled by this runner. Empty raw uploads are
rejected before entering sync; create blank code in CodeMirror instead.
**File** offers raw code, the portable code project, and a PNG of the last
successful run. Downloading a PNG never replaces the source or changes its save
target; add the image to the notebook separately if desired.

The private-notebook implementation keeps a local IndexedDB copy and a
separate account notebook in D1, with its files in private R2 storage. Moving
local notebook content to an account is an explicit copy, retaining the local
original. Existing account notebooks can be opened from another signed-in
device; pending work and revision conflicts are kept without silently
overwriting another copy. Local two-device browser checks covered notes,
topics, attached Ink source/preview files, reverse sync, account isolation,
and competing edits. These are isolated tests, not a production deployment;
see the deployment checklist before enabling the live service.

Strudel uses its separate remote iframe; use Strudel's own share control to
retain a tune.
