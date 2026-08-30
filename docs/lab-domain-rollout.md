# Lab address rollout

The app is prepared for `https://lab.juliaaurorahart.com/`. This document is a
release checklist, **not confirmation that the domain is live**.

## Read-only preflight: 2026-08-30

The signed-in Cloudflare dashboard confirms Pages project `osa`, production
branch `main`, automatic deployments, and the existing OSA custom domain.
Its production bindings are `OSA_DB` → `osa-private` and `OSA_ASSETS` →
`osa-assets`. The existing Access application `osa` protects
`osa.juliaaurorahart.com/api/*` with its `OSA Private` policy.

A read-only `sqlite_schema` query confirmed that the live database has the
three application tables `boards`, `board_shares`, and `board_collaborators`,
but **none of `private_assets`, `legacy_asset_grants`,
`private_asset_migrations`, or `lab_notebooks`**. No migration-history table
was present. The earlier private-storage/notebook database rollout is thus
still pending; do not interpret the deployed application code as evidence
that these migrations ran.

That preflight did not change database data/schema, Access rules, custom
domains/DNS, bucket settings, or the live deployment.

## Approved rollout: 2026-08-30

Julia approved the backups, missing additive database updates, and Lab
activation. The full database export and all R2 objects are now in a dated,
owner-only local backup directory outside the repository. The SQL backup
restored in memory; the migration rehearsal passed. Every object checksum
matches its original content-addressed key, and all referenced file keys are
covered. No remote files were altered or deleted.

Migrations `0007` and `0008` were then applied once to the confirmed database.
An independent post-migration export verified that all original schemas and
record hashes were unchanged, with clean integrity/foreign-key checks and
the exact historical grant set predicted by rehearsal.

The existing Access application's AUD matches `functions/access-config.ts`.
Its saved destinations are now `osa.juliaaurorahart.com/api/*` and
`lab.juliaaurorahart.com/api/*`, using the unchanged `OSA Private` policy.
Pages confirms the new `lab` CNAME to `osa-cni.pages.dev` is **Active** with
**SSL enabled**, alongside the unchanged active OSA domain. The source
deployment still needs final verification. No `www`, apex, or OSA DNS records
were changed.

The app build, Functions build, lint, 23 app suites, and the separate backup
verifier suite passed locally. Authenticated production notebook round trips
and portable-backup restoration remain separate checks. No recurring backup
service or second off-device copy has been configured.

## One deployment, two front doors

- Keep the existing Cloudflare Pages project, `osa`, and its current
  `OSA_DB` / `OSA_ASSETS` bindings. Do not create another notebook database or
  duplicate the bucket for the Lab.
- `osa.juliaaurorahart.com/` remains OSA. The new Lab host opens Lab at `/`,
  and **Exit Lab** navigates to the OSA root. Explicit public Assembly links
  still open their shared document on either host.
- `osa.juliaaurorahart.com/?lab=canvas` remains usable. There is no forced
  redirect, including from OSA's existing Lab control.
- The personal homepage, apex domain, `www` records, board schema, Shako data,
  collaborator permissions, and intentional public shares are not changed by
  this address addition.

Saved private-file references from either exact HTTPS production hostname
resolve through the current hostname's authenticated `/api/assets` route.
New uploads return relative file URLs. The browser does not send account
headers to the other host; this is URL normalization, not cross-origin API
access. Other hostnames and local/preview deployments do not inherit this
alias trust. File ownership and legacy grants remain authoritative.

## Existing browser-only work

IndexedDB and local settings belong to an origin. The new subdomain cannot
read the old subdomain's browser storage. Account-synced notebooks use the
same database after sign-in; local-only notes, file bytes, unsaved editor
work, and pending sync must be saved/synced or backed up at the old address.

Before switching, save open projects at the old Lab, confirm account sync,
and download a portable backup for important local-only work. The new Lab's
notebook includes an optional link back to the previous address. It does not
silently upload, clear, or move browser data. A theme preference may also need
to be chosen again on the new origin.

## Release checklist

1. Sign into Cloudflare and confirm the existing Pages project `osa`, its
   production branch, live deployment, and actual database/bucket bindings.
   A successful GitHub deployment check identifies the Pages project but
   does not establish its current bindings, Access policies, or schema.
2. Verify the private-storage rollout state against
   [the private-storage deployment guide](private-storage-deployment.md).
   In particular, confirm migrations `0007` and `0008` are already applied
   before deploying code that depends on them. Do not blindly replay them or
   rebuild legacy grants. **No additional SQL migration is needed solely for
   the Lab hostname.** Preserve backups before any outstanding migration.
3. Inspect the existing Cloudflare Access application protecting OSA APIs.
   Add the matching Lab API host/path entries to that same application, with
   the same policies and audience expected by `functions/access-config.ts`.
   Preserve the actual existing protected paths; do not introduce a wildcard
   domain, relax identity checks, or protect the whole public site by accident.
   If the current application cannot accommodate this, stop and resolve the
   policy design before deployment; do not change the audience speculatively.
4. Add `lab.juliaaurorahart.com` under the existing Pages project's **Custom
   domains**. Let Pages create/verify the corresponding DNS record in the
   correct zone, without changing the apex, `www`, or `osa` records. A CNAME
   by itself is not a Pages custom-domain association. Confirm certificate
   issuance and domain activation.
5. Deploy the matching frontend and Functions together after the storage/auth
   prerequisites are confirmed. A push to the production branch may deploy
   automatically; do not push merely to test local changes.
6. Verify both addresses:
   - Lab root and login return open Lab; **Exit Lab** opens OSA.
   - The old Lab address remains usable; local browser work stays available.
   - Owner account sees the same notebook and can save, reopen, and update an
     existing drawing with its original source and preview.
   - Owner/editor/viewer permissions still apply; anonymous users and signed-in
     outsiders cannot read private files by knowing a link or board ID.
   - Existing absolute OSA file references work from Lab, and new relative
     references work from OSA; no public bucket URL is needed.
   - Intentional public Assembly links, eligible images, and revoked access
     behave as before. `www` and the personal homepage remain unchanged.

If any prerequisite or check fails, keep using the old Lab address while
investigating. Do not repair a failed cutover by deleting browser storage,
recreating the database, loosening Access, or making the bucket public.

References: [Cloudflare Pages custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/),
[Access authorization cookies across application domains](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/),
[Access application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/),
and [IndexedDB origin boundaries](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Basic_Terminology).
