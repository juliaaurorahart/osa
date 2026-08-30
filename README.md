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
when selected. Workbench drafts remain temporary; use **Save to notebook**
where available, or download the image/native source before leaving the tool.
Saved notebook notes, files, and topics persist independently of project
boards. Original editable files and their previews are separate attachments.

For an editable project, set **Project name**, then use the workbench's
**Save to notebook** (draw.io's **Save** and Klecks' **Submit** also save
there). Saving updates the current notebook file; **Save a copy** creates a
separate item. Earlier saves remain available in **History**, with immutable
source and preview bytes for each saved version.
Notebook visits keep the current editor mounted; **Return to [tool]** resumes
it. Replacing the editor or leaving the Lab asks first. This is not draft
autosave, and closing the browser still requires an explicit save.

Notebook browsing/search and focused note editing are separate views. Files
can be moved to **Trash** and restored; removing a file does not permanently
delete its saved bytes or history. In **Notebook → Visuals & files**, use **Open in [tool]**, or filter to
**Editable projects only**. Supported native files currently include Ink,
Klecks PSD, draw.io, Excalidraw, Konva Lab, Paper, Mermaid, and Vega-Lite.
Preview images cannot restore layers or editable shapes. Other exports remain
downloadable; p5 source is not executed, and Pixi/Three/OSA Draw restoration is
not implemented here. Opening draw.io requires confirmation because its
editor is hosted at `embed.diagrams.net`, outside OSA. Saved native files are
validated before opening; Klecks additionally parses PSD layers inside its
local iframe. Imported Paper geometry is kept paused rather than regenerated.

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
