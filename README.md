# OSA

OSA is a durable connected-object Space for writing, sketching, actions, projects, and assembly work.

Nodes, connections, text, and properties are the shared data model. Notebook,
Actions, Projects, Assembly, and Space are views over that same data—not
separate stores. A focused view may understand particular property names, but
the underlying information remains normal editable OSA data and can appear in
every relevant view.

## Where a board is saved

- While you work, OSA writes a recovery draft to this browser's local storage after a short delay. That draft stays in this browser profile and does not sync to another device.
- On the signed-in deployed site, a new board is created automatically through `/api/boards`; later changes autosave to the same revision-guarded record in the Cloudflare D1 database bound as `OSA_DB`.
- Plain `npm run dev` is local-only because Vite does not run or proxy the Cloudflare board API. It keeps the browser recovery draft without writing to production. Settings retains a manual sync control plus database status for recovery and diagnostics.
- **Save JSON** downloads an independent copy of the current board that can be kept or imported later.

Cloudflare Access supplies the signed-in email address. Each board is read and saved only for that email address.

## Import the Shako source data

`imports/shako-light-wrap.osa.json` is a one-time bridge from the existing
assembly-instruction PowerPoint and BOM/expense workbook. Use **Import OSA
Data** and choose that JSON file. The validated package adds ordinary nodes and
edges to the current board, opens its Space, and shows its Assembly board. Use
the deployed site when the imported information should sync; cloud creation and
later saves then happen automatically.

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

The complete board is JSON in the `content` column. To make a database backup with Wrangler:

```sh
npx wrangler d1 export <database-name> --remote --output=./osa-backup.sql
```

The repository intentionally does not contain a D1 database ID, so the deployed `OSA_DB` binding in Cloudflare is the source of truth for which database receives saves.

Cloudflare references: [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [D1 SQL](https://developers.cloudflare.com/d1/sql-api/sql-statements/), and [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Visual tools Lab

The **Lab** menu opens isolated workbenches for draw.io, Excalidraw, Konva,
Fabric, Paper, p5.js, PixiJS, Strudel REPL, Three.js, Mermaid, Vega-Lite, and
CodeMirror. Each engine loads only when selected. Lab drafts are disposable
and never alter the current board; download an image or native source file
before switching workbenches. Strudel uses its officially documented remote
iframe so its AGPL application remains separate from OSA; use Strudel's share
control to retain a tune.
