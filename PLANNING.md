# Planning Notes

## Current Shape

- `src/server.js` is a dependency-light Node HTTP server.
- `public/` contains the browser UI: HTML, CSS, and vanilla JavaScript.
- `extension/` contains the unpacked Chrome extension **GP Auth Helper**.
- `media/catalog.json` stores the local catalog and is repaired from files on disk when loaded.
- Media files are saved under date-based folders inside `MEDIA_DIR`.
- `MEDIA_DIR` can point outside the repo, including mounted remote drives or cloud-synced folders; `catalog.json` stays alongside the media.
- Catalog items can store `sha256`, `fileSize`, and `verifiedAt` after a library verification pass.
- Duplicate media is marked directly on catalog items with `duplicateGroupSize` and `duplicateOf`.
- Orphan local media files are tracked in `catalog.orphanFiles`.
- Catalog backups are timestamped JSON snapshots under `MEDIA_DIR/_catalog_backups`.
- `.mise.toml` pins Node.js and pnpm. `pnpm-workspace.yaml` holds project package-manager settings and security defaults.
- `environment.toml` defines Codex local environment setup plus actions for starting the server and running tests.

## API And Auth

The source API uses a short-lived Clerk session JWT:

```js
await window.Clerk?.session?.getToken()
```

The token is sent to the API as:

```text
Authorization: Bearer <token>
```

The extension reads that token from the logged-in page and posts it to:

```text
POST http://localhost:5177/api/auth/token
```

The server stores the token in memory only. Token refresh is automatic every 30 seconds while the source tab is open.

## Sync Behavior

- The API endpoint shape inferred from the HAR is `GET /api/jobs?type=all&page=N`.
- Media URLs are read from `results[].output_url`.
- Downloadable items are completed jobs whose output URL ends in `.png` or `.mp4`.
- The app tracks `lastSeenJobId` for incremental scans.
- Known missing local files can be downloaded without fresh API auth if their `outputUrl` is already present in the catalog.
- Catalog repair scans local media filenames for job UUIDs and reattaches existing files to catalog items.
- Dedicated local download actions can download missing catalog files or retry previous download errors without scanning the API.
- Long-running API scans, download queues, and thumbnail jobs support cooperative cancellation between pages/files.
- Video thumbnails are generated as local JPG posters under `MEDIA_DIR/_thumbnails` using `ffmpeg` when available; missing ffmpeg is non-fatal.
- Library verification scans local PNG/MP4 files, hashes them, repairs catalog file metadata, marks duplicate groups, and records orphan files.
- Catalog backups are created before catalog-mutating long jobs and before restore; restore also creates a `before-restore` snapshot of the current catalog.

## Test Coverage

- `mise exec -- pnpm test` runs Node's built-in test runner.
- Server tests stub Clerk/API auth, paginated API responses, and media downloads.
- Current coverage checks missing-file downloads, authenticated API scans, cancellation, thumbnail generation, duplicate detection, orphan tracking, catalog backup/restore safety, and module-scope helper exports used by sync.
- The UI smoke test uses Playwright with the locally installed Chrome channel against a temporary server and fixture media directory.

## Package Management

- Node.js `26.2.0` and pnpm `11.3.0` are pinned through mise.
- pnpm is activated through mise's `npm:pnpm` backend because this local mise build could not resolve pnpm 11's renamed darwin release assets through the default aqua backend.
- pnpm security settings include strict engine checks, strict peer dependency checks, a 24-hour minimum release age, strict dependency build approval, and package-manager version strictness.

## UI Behavior

- Media/status filters, sorting, page, page size, search query, and view mode persist in URL query params.
- The web UI polls sync status and catalog changes so downloads appear while sync is running.
- Gallery videos use `preload="metadata"`.
- Summary tiles provide quick collection health checks and jump to status filters.
- Header actions expose incremental sync, missing-file downloads, failed-download retry, and full API rescan as separate operations.
- Header actions also expose thumbnail generation, library verification, and a cancel button while a long-running job is active.
- A catalog backup panel exposes export, manual backup creation, and explicit restore from timestamped backups.
- Active filter chips make the current narrowed view visible and easy to clear.
- Status filters include downloaded, missing, errors, duplicates, unverified, and favorited.
- Item details open in a dialog with larger preview, full prompt, metadata, and copy actions.
- Keyboard shortcuts: `/` focuses search; left/right arrows page through results when not typing.

## Future Ideas

- Add prompt tags or manual notes in a sidecar metadata file.
- Add keyboard shortcuts for browsing/copying prompts.
- Add import of external `catalog.json` files.
- Split browser smoke coverage into smaller focused UI tests if the single smoke test becomes hard to diagnose.
