# Private storage and deployment

On 2026-08-30, the read-only preflight found missing private-file and notebook
tables. After Julia's approval, the complete D1 export and all R2 objects were
backed up outside the repository. SQL restore/rehearsal, content checksums,
and referenced-file coverage passed before migrations 0007/0008 were applied.
A second live export verified unchanged original schemas/records, the expected
frozen grants, and clean integrity/foreign-key checks. No files were deleted
or made public. See [Lab address rollout](lab-domain-rollout.md) for hosting
status and the live user-flow checks; database verification alone is not a
claim that every browser/account workflow has been exercised in production.

Later on 2026-08-30, migration `0009_lab_notebook_catalog.sql` was applied to
the existing `osa-private` database after a fresh private SQL export and clean
rehearsal. An independent post-update export matched every pre-existing
board/share/collaborator/private-file/default-notebook row and the expected
catalog backfill, with clean integrity and foreign-key checks. No R2 object
was modified or deleted by this metadata-only update. The fresh SQL backups
do not replace the separate file-byte backups described above.

## Storage and permission boundaries

| Location | What it holds | Boundary |
| --- | --- | --- |
| Browser storage | Board recovery drafts; Lab notebook documents, pending changes, and file copies | This browser profile, with separate guest/account scopes |
| D1 `boards` | OSA graph JSON and revisions | Board owner plus named editor/viewer records |
| D1 `private_assets` + R2 `OSA_ASSETS` | File ownership/metadata in D1; original bytes and previews in R2 | Exactly one owning board per file record |
| Portable JSON download | A graph snapshot with accessible managed file bytes embedded as data URLs | Anyone receiving that downloaded copy |

Local separation prevents accidental account mixing; it is not encryption
against someone who controls the browser profile or device. Signing out does
not erase earlier downloaded or cached copies. Keep backups before clearing
browser data.

New/imported boards stay local until **Sync to my account**. After that, cloud
edits autosave against the last known revision. A stale revision is a conflict,
not permission to overwrite newer data. Copies/imports need their own file
records when moved into a different board; an old board's file URL does not
grant the new board's collaborators access.

The server trusts Cloudflare Access's verified email, not browser state or a
supplied `boardId`. An optional `x-osa-account` header can reject an unexpected
account change, never authorize a request. `/api/session` returns the verified
identity. Named collaborators must also be allowed through the site's
Cloudflare Access sign-in policy; adding a board collaborator does not change
that external policy or send an email invitation.

| Role on a private board | Read board/files | Edit/upload files | Manage invitations/publication |
| --- | --- | --- | --- |
| Owner | Yes | Yes | Yes |
| Editor | Yes | Yes | No |
| Viewer | Yes | No | No |
| Signed-in person without access | No | No | No |

Files use authenticated `/api/assets` reads, with `private, no-store`,
`nosniff`, and sandboxed responses. Only raster images render inline; SVG and
native source formats are downloads. Individual file transfers are limited
to 25 MB. The board portable-export path also caps fetched managed-file bytes
at 100 MB; embedded JSON/base64 can be larger than the original files. Raw D1
exports are not portable image backups, and external web links are not copied.

## Lab notebook

`lab_notebooks` associates one verified account with a separate notebook board.
`lab_notebook_catalog` adds multiple deliberately named notebooks while keeping
that legacy default association. Catalog names have independent revisions so
an older client saving a hardcoded title cannot undo a deliberate rename.
Notebook list/open/create/rename operations require owner-matched catalog or
legacy membership; a known ordinary board ID is not enough. Default notebooks
created during rolling deployment remain readable and are catalogued on rename.
The graph uses ordinary OSA nodes/edges for notes, artifacts, topics, and their
relationships; it is not the user's currently open project board. Its backing
board is excluded from normal board lists. File authorization uses the same
board ownership rules instead of introducing a second public file store.
Named notebook scopes isolate local documents, recoveries, and immutable file
copies even within one account. Naming does not alter scope or file identity.
An inactive notebook's unsynced outbox remains on that device until reopened.

Guest/local content is copied to the account only through the explicit
notebook action. Its original remains local. Account-scoped IndexedDB keeps
pending changes and source/preview Blobs; cloud saves upload files before the
snapshot references them. Local and cloud revision checks retain recovery
copies on conflicts. A notebook portable export embeds its source/preview
files in OSA JSON; it is not a ZIP archive.

Local browser verification on 2026-08-30 used two independent browser-storage
origins and a shared throwaway backend. An Ink drawing (editable source plus
PNG preview), a note, topic links, and an attachment relationship survived
explicit account copying and appeared on the second origin. An edit synced
back to the first origin. A different identity saw an empty notebook, and a
stale-account tab was blocked from syncing. Simultaneous edits produced a
conflict without replacing the losing device's text.

The backup-generation code is covered separately by automated tests. The
in-app browser did not report a download event during the backup-button check,
so actual file delivery still needs a normal-browser smoke test. No production
authentication, database migration, bucket policy, or deployment was verified
by these local tests. Repeat the release checks after the live cutover.

Private cached notebooks are reopened only after account verification; there
is no offline unlock mechanism. An already-open account notebook can keep
editing offline and retain its outbox. Reopening the site while signed out or
unable to verify the account offers the local guest notebook, not another
account's cached private data.

## Legacy images and public Assembly links

Old `/media/images/<hash>.<extension>` URLs historically delivered publicly
cacheable images. The new bare `/media` route denies reads. Owners, editors,
and viewers can still read eligible legacy images through a board-authorized
`/api/assets?boardId=...&legacyKey=...` request; owners/editors can copy them to
protected file storage. This does not delete the old blobs.

Migration `0007_private_assets.sql` freezes `legacy_asset_grants` from existing
board snapshot references. Both a historical grant and a current reference
are required: pasting a known image URL into a new board cannot claim its
bytes. The seed recognizes relative `/media/...` URLs and
`https://osa.juliaaurorahart.com/media/...`. Audit any legitimate historical
hostname variants before migration; do not grant arbitrary hosts or rebuild
grants from later user-editable JSON. The seed marker prevents accidental
re-seeding if the migration SQL is replayed.

An intentional public Assembly link remains anyone-with-the-link access.
`/shared/<reference>` projects the selected Assembly and rewrites eligible file
references to that share's file route. Each request verifies the file belongs
to the source board and is referenced in the projected Assembly; legacy files
also need a frozen grant. An unrelated private board/file is not made public
by knowing its ID. Use named collaborators, not public links, for private Shako
access. Keep public links only where publication is intended.

Earlier responses advertised a one-year public cache. Closing the server route
cannot recall browser caches, downloaded files, screenshots, or copies already
shared by recipients.

## Safe deployment sequence

1. **Confirm authority and targets.** Sign into the correct Cloudflare account.
   Identify the deployed Pages project and its actual `OSA_DB` and `OSA_ASSETS`
   bindings; production IDs are deliberately absent from this repository.
   Check that private APIs require Access, while the public app and deliberately
   public Assembly routes remain reachable as intended. Do not infer access
   policy from local tests.
2. **Back up first.** Export D1 schema/data, preserve R2 objects separately, and
   retain important unsynced local/portable copies. Verify the backups are
   readable. D1 export alone does not include R2 or browser data; schedule the
   export appropriately because it can block database requests.
   [Cloudflare D1 export documentation](https://developers.cloudflare.com/d1/best-practices/import-export-data/).
3. **Confirm the bucket is private.** Check both its `r2.dev` development URL
   and every custom-domain access path. Protecting the app route does not close
   an independently public bucket URL. Do not enable a public bucket for shared
   Assembly images; the share route serves those itself. Review cache rules so
   they do not override private responses.
   [Cloudflare public-bucket access documentation](https://developers.cloudflare.com/r2/buckets/public-buckets/).
4. **Arrange a write-free cutover.** Preserve drafts and stop editing/uploads
   from old tabs while the historical grants are seeded and the release is
   deployed. New legacy URLs saved after that seed would not receive grants.
   Confirm previously applied migrations `0001`–`0006`; do not blindly replay
   an old schema against an existing database.
5. **Apply `0007_private_assets.sql`, then `0008_lab_notebooks.sql`, before
   deploying the new code.** Use the approved deployment configuration with
   the confirmed database name and this repository's migrations directory.
   Wrangler-managed migrations normally record history; the confirmed live
   database has no migration-history table. Compare the actual schema with
   `0001`–`0006`, then apply only the reviewed missing `0007`/`0008` files to
   that database. Do not use a blanket migration replay against this existing
   database, or assume an absent history table means an empty database.
   [Cloudflare migration documentation](https://developers.cloudflare.com/d1/reference/migrations/).
   Check the new tables/seed marker and expected historical grants, including
   intentionally shared Shako references. Do not delete/reset the seed marker
   to make unverified references work.
6. **Deploy the matching frontend and Functions together.** Keep the same
   confirmed bindings. Reload old tabs and check private account/board access,
   file uploads/downloads, and existing intentional Assembly links. If legacy
   public responses were cached by a CDN rule, handle that cache through the
   approved cache-management process; browser-held copies remain outside the
   server's control.
7. **Verify before resuming normal work.** Complete the checks below against
   the deployed configuration using harmless test content. Report any failed
   gate explicitly; do not present local checks as live Cloudflare validation.

The migrations are additive. Keep their tables, grant records, and R2 objects
during recovery. Reverting to the old public `/media` handler would reintroduce
exposure; prefer a reviewed forward fix or a controlled unavailable state.
Do not delete files or relax grants as a shortcut for a failed migration.

## Release checks

- Guest text/image editing and JSON export/import stay local until explicit sync.
- Owner/editor can save and upload; viewer can read but not upload; unrelated
  accounts cannot read board JSON or files, even with a known URL.
- Switching accounts blocks in-flight writes associated with the previous
  account and does not silently adopt guest/private data.
- A clean second-device session sees the private notebook's notes, topics,
  original files, and previews; ordinary board lists do not expose its backing
  board. Offline/retry and two-tab revision conflicts preserve work.
- Intentionally public Assembly links still display their allowed images;
  unrelated board files and forged post-migration legacy references are denied.
- Portable JSON loads with managed files present; an inaccessible file fails
  visibly rather than producing a misleadingly complete export.

Local checks include `npm test`, `npm run build`, `npm run lint`, and
`node scripts/check-private-assets.mjs` (Node 24's built-in SQLite is used).
`node scripts/preview-private-storage.mjs` starts isolated loopback previews on
ports 4175/4176 with a shared in-memory test database/files. The visible
`/__test/controls` page changes only test identities. Those ports use separate
browser storage; managed-file port aliases emulate a second device using the
same real site. The harness is outside deployed bundles, has no Cloudflare
credentials, and loses its test server data when stopped. It does not replace
production smoke tests.
