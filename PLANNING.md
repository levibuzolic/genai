# Planning Notes

## Current Shape

- `src/server.js` is a dependency-light Node HTTP server.
- `public/` contains the built React app served by the Node server.
- `client/src/` contains the React 19 + Vite source app.
- `media/catalog.sqlite` stores the local catalog and create-template registry.
- Media files are saved under date-based folders inside `MEDIA_DIR`.
- `MEDIA_DIR` can point outside the repo, including mounted remote drives or cloud-synced folders; `catalog.sqlite` stays alongside the media.
- Catalog items can store `sha256`, `fileSize`, and `verifiedAt` after a library verification pass.
- Duplicate media is marked directly on catalog items with `duplicateGroupSize` and `duplicateOf`.
- Orphan local media files are tracked in `catalog.orphanFiles`.
- Catalog backups are timestamped SQLite snapshots under `MEDIA_DIR/_catalog_backups`.
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

The app-owned auth browser is the primary auth path:

- `POST /api/auth/browser/connect` opens a visible persistent Chrome profile for the user-driven email/password/OTP login.
- Once Clerk is signed in, the backend captures `window.Clerk?.session?.getToken()`, stores the bearer token in memory, closes the visible browser, and schedules refresh.
- The persistent profile lives at `AUTH_BROWSER_PROFILE_DIR`, defaulting to `MEDIA_DIR/_auth_browser_profile`, so it can survive server restarts.
- On startup, if that profile exists, the server attempts a headless refresh in the background.
- `POST /api/auth/browser/refresh` forces a headless token refresh.
- `POST /api/auth/browser/disconnect` closes the managed browser and optionally removes the profile when `deleteProfile` is true.

Playbox auth can also import browser cookie state from a copied cURL request so the server can refresh Playbox access tokens from Node.

The server stores bearer tokens in memory only. The persistent browser profile and imported cookie sessions contain normal browser session state and must be treated as sensitive local data.

## Sync Behavior

- The API endpoint shape inferred from the HAR is `GET /api/jobs?type=all&page=N`.
- Media URLs are read from `results[].output_url`.
- Downloadable items are completed jobs whose output URL ends in `.png` or `.mp4`.
- The app tracks `lastSeenJobId` for incremental scans.
- Known missing local files can be downloaded without fresh API auth if their `outputUrl` is already present in the catalog.
- Catalog repair scans local media filenames for job UUIDs and reattaches existing files to catalog items.
- Dedicated local download actions can download missing catalog files or retry previous download errors without scanning the API.
- Background sync is enabled by default for the CLI server: one incremental sync shortly after boot, then another attempt every hour. It skips when another long-running library job is active.
- Long-running API scans, download queues, and thumbnail jobs support cooperative cancellation between pages/files.
- Video thumbnails are generated as local JPG posters under `MEDIA_DIR/_thumbnails` using `ffmpeg` when available; missing ffmpeg is non-fatal.
- Library verification scans local PNG/MP4 files, hashes them, repairs catalog file metadata, marks duplicate groups, and records orphan files.
- Catalog backups are created before catalog-mutating long jobs and before restore; restore also creates a `before-restore` snapshot of the current catalog.

## Test Coverage

- `mise exec -- pnpm test` runs strict typechecking, the Vite build, focused Vitest unit tests, and Node/browser smoke tests.
- Server tests stub Clerk/API auth, paginated API responses, and media downloads.
- Current coverage checks missing-file downloads, authenticated API scans, cancellation, thumbnail generation, duplicate detection, orphan tracking, catalog backup/restore safety, and module-scope helper exports used by sync.
- The UI smoke test uses Playwright with the locally installed Chrome channel against a temporary server and fixture media directory.

## Package Management

- Node.js `26.2.0` and pnpm `11.3.0` are pinned through mise.
- pnpm is pinned directly through mise. Use `mise exec -- pnpm ...` for all package, build, lint, and test commands.
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

## Future Work

### Creation API QA

- Exercise the live creation API end to end for gallery image sources, image uploads, pasted images, image URLs, video uploads, and video URLs.
- Confirm job polling, failed-job states, result download, and catalog merge behavior against real API responses.
- Capture any remaining custom-mode API shapes as stable mocked fixtures before expanding UI affordances.

### Auth UX

- Make reconnect and refresh states more explicit when the auth browser profile can no longer refresh.
- Add a confirmed destructive action for deleting the persisted auth browser profile when a full logout/reset is needed.
- Make Playbox's managed Chrome profile and cURL-cookie import states clearer when refresh fails.

### Background Sync UX

- Add a visible pause/resume control for automatic sync when we want to work locally without background jobs starting.
- Consider delaying the boot sync until auth refresh has either succeeded or clearly failed, so authenticated API scans start cleanly.
- Track the last automatic sync outcome separately from manual syncs if users need a clearer operational history.

### Templates And Creation Workflow

- Build a custom template manager for labels, seed job IDs, prompts, source requirements, and quality defaults.
- Turn history-prompt import into a polished template creation flow rather than a utility-style form.
- Add a creation queue/history area for active jobs, failed jobs, retries, downloads, and recently created media.

### Privacy Mode

- Extend the current media blur toggle into a broader privacy mode that can also hide prompts, filenames, URLs, and explicit metadata while screen-sharing.
- Make privacy mode state obvious in the header so users do not accidentally assume sensitive text is hidden when only visuals are blurred.

### Performance And Test Shape

- Normalize the SQLite schema further for server-side filtering/sorting once catalog size makes in-memory filtering noticeably slow.
- Split browser smoke coverage into smaller focused UI tests if the single smoke test becomes hard to diagnose.
- Add keyboard shortcuts for browsing, copying prompts, and moving between detail views once the core flows stabilize.
