# Local Media Library

Local-only Node.js web app for syncing generated media metadata, downloading media files to disk, creating new media from existing assets/uploads/URLs, and browsing the local collection with prompt text.

Auth is owned by the local Node app. It can open a visible Playwright/Chrome login window once, persist that browser profile under the media directory, and refresh short-lived Clerk tokens headlessly on later runs. The companion Chrome extension, **GP Auth Helper**, remains as a fallback token forwarder.

## Requirements

- [mise](https://mise.jdx.dev/) for the pinned Node.js and pnpm versions
- Chrome, for the app-owned auth browser and optional unpacked auth helper extension
- A source-site account that can complete email/password/OTP login

## Tooling

This repo pins Node.js `26.2.0` and pnpm `11.3.0` in `.mise.toml`.

```sh
mise trust
mise install
mise exec -- pnpm install
```

pnpm security defaults are configured in `pnpm-workspace.yaml`, including strict engines, a 24-hour release age gate, strict dependency build approvals, and strict package-manager version checks.

## Codex Environment

Codex local environment actions are configured in `environment.toml`.

- Setup installs the pinned mise tools and runs `pnpm install --frozen-lockfile`.
- **Start server** runs `mise exec -- pnpm start`.
- **Run tests** runs `mise exec -- pnpm test`.

## Run The Server

```sh
mise exec -- pnpm start
```

Then open:

```text
http://localhost:6173
```

`pnpm start` runs both the backend API server and the Vite frontend server. During local development, direct browser visits to the backend port redirect to Vite; if Vite is not running, the backend returns a short error page instead of serving stale built assets. To serve the built `public/` assets without Vite, run `mise exec -- pnpm start:api`.

The server stores downloaded files in `media/` by default. It stores app catalog data in SQLite:

```text
media/catalog.sqlite
```

SQLite is the only app-data store. Catalog backups are SQLite snapshots stored beside the database:

```text
media/_catalog_backups/
```

To store the library on a mounted remote drive or cloud-synced folder, set `MEDIA_DIR` in `.env` to an absolute path:

```sh
MEDIA_DIR=/Volumes/RemoteDrive/gp-media-library
```

Home-relative paths are also supported:

```sh
MEDIA_DIR=~/Library/CloudStorage/Dropbox/gp-media-library
```

The remote drive should be mounted before starting the server. `catalog.sqlite` lives in the same directory as the downloaded media so the library can stay separate from the project checkout.

## Configuration

Copy `.env.example` to `.env` if you want to change defaults:

```sh
cp .env.example .env
```

Useful settings:

- `PORT`: local API/static server port, defaults to `6177`
- `VITE_PORT`: local Vite app server port, defaults to `6173`
- `LOCAL_APP_URL`: optional URL override for the startup message; by default the server detects this repo's Vite dev server on ports `6173`-`6183`, then falls back to the API/static server URL
- `REDIRECT_STATIC_TO_VITE`: redirect direct browser visits to the API/static server back to Vite when the dev server is running, defaults to `true`; `/api` and `/media` are never redirected
- `MEDIA_DIR`: download/catalog directory, defaults to `media`; absolute and `~` paths are supported
- `GENERATEPORN_PAGE_LIMIT`: max API pages to scan
- `GENERATEPORN_APP_URL`: visible/headless auth browser URL, defaults to `https://app.generateporn.ai/`
- `AUTH_BROWSER_PROFILE_DIR`: persistent auth browser profile directory, defaults to `MEDIA_DIR/_auth_browser_profile`
- `PLAYBOX_APP_URL`: visible Playbox auth URL, defaults to `https://www.playbox.com/collection`
- `PLAYBOX_AUTH_BROWSER_PROFILE_DIR`: persistent Playbox Chrome profile directory, defaults to `MEDIA_DIR/_playbox_auth_browser_profile`
- `PLAYBOX_AUTH_IMPORT_PATH`: imported Playbox cURL session file, defaults to `MEDIA_DIR/_playbox_auth_session.json`
- `PLAYBOX_CHROME_PATH`: optional path to the Chrome executable used for Playbox auth
- `AUTH_BROWSER_REFRESH_MS`: fallback headless refresh interval, defaults to 15 minutes
- `AUTO_SYNC_ENABLED`: run background incremental syncs while the server is running, defaults to `true`
- `AUTO_SYNC_STARTUP_DELAY_MS`: delay before the boot sync, defaults to 10 seconds
- `AUTO_SYNC_INTERVAL_MS`: delay between background sync attempts, defaults to 1 hour
- `GENERATEPORN_AUTHORIZATION`: optional short-lived fallback bearer token

Prefer the in-app auth browser for auth. Static tokens expire quickly.

## Auth Browser

1. Start the local app.
2. Open the **More** menu in the top bar.
3. Choose **Auth browser > Connect account**.
4. Complete the source-site login in the visible browser window, including the email OTP step.
5. The server captures the Clerk session token, closes the visible window, and keeps the persistent browser profile for future headless refreshes.

The persisted browser profile survives server restarts as long as `AUTH_BROWSER_PROFILE_DIR` is not deleted. On startup, the server attempts a headless refresh from that profile. If the saved session can no longer refresh, use **Connect account** again.

Playbox auth uses a dedicated server-owned Chrome profile instead of the Playwright auth browser. The server opens normal Chrome visibly, you complete Playbox/Cloudflare/login there, and the backend connects to that Chrome through the Chrome DevTools Protocol to capture the current Playbox access token. Playbox refreshes may briefly reopen visible Chrome because headless refresh is not reliable behind its bot checks.

The local server keeps API tokens in memory only. It does not write bearer tokens to `.env`, `media/catalog.sqlite`, SQLite exports/backups, or the persisted browser profile directory. The browser profile contains normal browser session state and should be treated as sensitive.

## Auth Helper Extension

The extension is now a fallback path when the app-owned auth browser is not suitable.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` directory.
5. Visit the source site while logged in.
6. Keep that tab open while syncing from the local app.

The extension refreshes auth every 30 seconds while the logged-in tab is open. You can also press **Send auth to local app** to force an immediate refresh.

## Playbox cURL Auth Import

If Playbox's Cloudflare check works in your normal Chrome profile but not in the server-owned auth window, import one authenticated API request from Chrome:

1. Start the local app.
2. Open `https://www.playbox.com/collection` in your normal Chrome profile and sign in.
3. Open DevTools, then the Network tab.
4. Select a successful request to `api.playbox.com`, preferably `users/me-new` or `refresh-token`.
5. Choose **Copy as cURL**.
6. Open **Settings > Playbox Auth** in the local app, paste the cURL command, and import it.

The server parses the request's cookie/header state, immediately validates that it can mint a fresh Playbox access token from Node, and stores the imported session at `PLAYBOX_AUTH_IMPORT_PATH`. The bearer token remains in memory only, but the imported cookie session is sensitive and should be treated like a browser profile.

## Background Sync

When the server starts, it schedules an incremental sync after `AUTO_SYNC_STARTUP_DELAY_MS`, then repeats every `AUTO_SYNC_INTERVAL_MS`. Scheduled syncs skip themselves if another sync, download, thumbnail, or verification job is already running.

If API auth is not active yet, the scheduled sync still downloads known missing files from existing catalog URLs. Once auth refresh succeeds, later scheduled syncs scan the API for new jobs.

## Roadmap

Near-term project direction is tracked in `PLANNING.md`. The main themes are live creation API QA, stronger auth and auto-sync controls, custom template management, creation queue/history, broader privacy mode, and performance/testing cleanup as the catalog grows.

## Using The App

In the local web UI:

- **Sync & download missing** downloads known missing files and, when auth is active, syncs newly available API metadata.
- **Download missing** downloads catalog items that are known but do not have a local file.
- **Retry errors** retries items whose previous media download failed.
- **Generate thumbnails** creates local poster JPGs for downloaded videos when `ffmpeg` is available.
- **Verify library** hashes local media, refreshes file sizes, marks duplicate catalog items, and reports orphan files in the media directory.
- **Cancel** appears while a sync, download, thumbnail, or verification job is running and stops after the current API page or file finishes.
- **Full API rescan** scans the API from page 1.
- **Export database** downloads the current SQLite catalog database.
- **Create backup** writes a timestamped SQLite catalog snapshot under `_catalog_backups`.
- **Restore backup** restores a selected snapshot and first creates a `before-restore` backup of the current catalog.
- Search and filters are stored in the URL so reloads preserve your place.
- Use media/status filters, including duplicates and unverified files, sort order, page size, and grid/list view to browse larger collections.
- Each item has a **Copy prompt** button.

Videos use local poster thumbnails when available and render with `preload="metadata"` so durations can be shown without eagerly loading entire files.

Verification stores `sha256`, `fileSize`, and `verifiedAt` on catalog items. Duplicate groups are marked with `duplicateGroupSize` and `duplicateOf`; files in `MEDIA_DIR` that do not map to a catalog item are listed in the catalog under `orphanFiles`.

The server automatically creates a catalog backup before sync, download, thumbnail generation, library verification, history reset, and restore operations.

## Tests

Run the automated tests with:

```sh
mise exec -- pnpm test
```

The tests stub API auth, API responses, and media downloads so they do not call the live service. The UI smoke test launches the locally installed Google Chrome via Playwright and uses a temporary media directory with fixture catalog data.

## Local Files

Generated local files are ignored by git:

```text
media/
.env
*.har
```

The HAR file in the repo root was used to infer the API shape. New HAR files are ignored by default.
