# Development data and recovery

Keep the existing D1 database for records and R2 for file bytes. Development
experiments should not need permission to risk Julia's real notebook or Shako
data. This document describes safeguards and proposed next steps, not a claim
that a production backup or separate development store has been provisioned.

## Three places with different purposes

- **Real work:** the existing account database and private file bucket. The
  OSA and Lab production addresses share this data after sign-in.
- **Disposable tests:** the existing loopback preview fixture uses in-memory
  SQLite and files. Stopping it loses its server data; keep using it for tests,
  not as the only home for drawings or notes worth retaining.
- **Lasting development work:** provision a separate persistent local store,
  or explicitly separate Cloudflare preview database and bucket bindings,
  when needed. Neither is configured by this document. Confirm the actual
  bindings before using a preview; a different URL does not prove isolation.

Use synthetic data for ordinary tests. A production copy contains private
information and needs the same care as the original. Do not commit database
exports, drawings, backup manifests, credentials, or account data to Git.

## What a complete backup contains

Before a data migration, pause edits, save open workbenches, and make a dated
backup in a private directory outside the repository:

1. The complete D1 schema and rows, not just the current board JSON.
2. Every R2 object under its original key, including editable source files,
   previews, legacy images, and retained versions. Use read-only downloads;
   do not run a destructive synchronization or remove originals.
3. An inventory of keys, byte sizes, and SHA-256 checksums, checked against
   the files actually downloaded and references found in the database.
4. Important unsynced browser work, exported separately from the original
   address. D1/R2 backups cannot recover content that never reached them.

Keep a second protected copy off the development computer. This is a
recommendation, not an existing scheduled backup service. A successful export
or a checksum alone is not proof that the application can recover its data.

## Prove recovery without touching production

Restore the SQL into an isolated database and check integrity, expected
tables, row counts, and file references. Rehearse additive migrations there;
compare the existing records before and after. Verify actual file bytes and
open an editable source plus its preview in a throwaway environment. After a
live migration, compare another export against the pre-migration records.

The repository's read-only SQL verifier restores a trusted Cloudflare export
into memory, rehearses migrations `0007`/`0008`, and compares original row and
schema hashes. It does not access Cloudflare or download/check R2 file bytes:

```sh
node scripts/verify-osa-backup.mjs <before.sql> --report <private-backup-directory>/before-report.json
node scripts/verify-osa-backup.mjs <before.sql> --compare <after.sql> --report <private-backup-directory>/comparison-report.json
```

Use Node 24.12 or newer. Reports require an existing owner-only directory
and never overwrite an existing file. Console output contains counts/hashes,
not private content; the optional report includes object keys. Exit `2` means
the SQL was verified but references or schema details need review before
proceeding, and exit `1` means verification failed. Neither means approval to
migrate. Run its synthetic checks with `npm run test:backup`.

Never rehearse by restoring over the live database. D1 Time Travel is a
separate emergency recovery layer; it does not restore R2 objects or local
browser drafts. Immutable saved versions and recoverable Trash are useful,
but are not independent backups and do not imply unlimited retention.

The Lab can export a notebook with files in portable OSA JSON. A dedicated
full-notebook restore/import interface is **not implemented**; adding and
testing it is a useful follow-up. Importing individual files is not the same
as restoring notebook metadata, topics, and links.

References: [Cloudflare Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/),
[D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/),
[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
and [R2 read-only token permissions](https://developers.cloudflare.com/r2/api/tokens/).
