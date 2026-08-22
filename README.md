# OSA

OSA is a notebook and connected-node space for writing, sketching, tasks, and projects.

## Where a board is saved

- While you work, OSA writes a recovery draft to this browser's local storage after a short delay. That draft stays in this browser profile and does not sync to another device.
- **Save board** sends the complete board snapshot to `/api/boards`. On the deployed site, that API stores the snapshot in the Cloudflare D1 database bound to the Pages project as `OSA_DB`.
- **Save JSON** downloads an independent copy of the current board that can be kept or imported later.

Cloudflare Access supplies the signed-in email address. Saved boards are read and replaced only for that email address.

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
