# OSA

OSA is a playful thinking canvas for drawings, meaningful objects, and the relationships that bring them to life.

It is an early working lab: draw freely, add objects and shapes, connect their signals and slots, give them attributes, and save different versions of a board.

## Private cloud saves

OSA has two intentional saving modes. A signed-in owner saves boards to Cloudflare D1, after the API validates their Cloudflare Access identity. Visitors can still use the public playground, but their boards stay only in their own browser and are never sent to OSA's database.

To enable private cloud saves for `osa.juliaaurorahart.com`, create a Cloudflare Zero Trust Access application for the path `/api/*` on that hostname (allow only the owner's email with One-time PIN), copy its team domain and audience into `functions/access-config.ts`, then bind a D1 database as `OSA_DB` in the Pages project and apply `migrations/0001_boards.sql`. OSA itself stays public; only the private-save API is protected. Until Access is configured, the API fails closed and OSA stays browser-only.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```
