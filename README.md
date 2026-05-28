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
http://localhost:5177
```

The server stores downloaded files in `media/` by default. It stores app catalog data in SQLite:

```text
media/catalog.sqlite
```

If older `media/catalog.json` or `media/create-templates.json` files exist, the server treats them as one-time migration inputs. When SQLite has no matching data yet, it imports them and then moves the JSON files into `media/_legacy_json/`. When SQLite already has data, it moves those JSON files into `media/_legacy_json/` and ignores them. JSON is still used for exports and backups. Catalog backups are stored beside the database:

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

- `PORT`: local web server port, defaults to `5177`
- `MEDIA_DIR`: download/catalog directory, defaults to `media`; absolute and `~` paths are supported
- `GENERATEPORN_PAGE_LIMIT`: max API pages to scan
- `GENERATEPORN_APP_URL`: visible/headless auth browser URL, defaults to `https://app.generateporn.ai/`
- `AUTH_BROWSER_PROFILE_DIR`: persistent auth browser profile directory, defaults to `MEDIA_DIR/_auth_browser_profile`
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

The local server keeps API tokens in memory only. It does not write bearer tokens to `.env`, `media/catalog.sqlite`, JSON exports, or the persisted browser profile directory. The browser profile contains normal browser session state and should be treated as sensitive.

## Auth Helper Extension

The extension is now a fallback path when the app-owned auth browser is not suitable.

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` directory.
5. Visit the source site while logged in.
6. Keep that tab open while syncing from the local app.

The extension refreshes auth every 30 seconds while the logged-in tab is open. You can also press **Send auth to local app** to force an immediate refresh.

## Background Sync

When the server starts, it schedules an incremental sync after `AUTO_SYNC_STARTUP_DELAY_MS`, then repeats every `AUTO_SYNC_INTERVAL_MS`. Scheduled syncs skip themselves if another sync, download, thumbnail, or verification job is already running.

If API auth is not active yet, the scheduled sync still downloads known missing files from existing catalog URLs. Once auth refresh succeeds, later scheduled syncs scan the API for new jobs.

## Using The App

In the local web UI:

- **Sync & download missing** downloads known missing files and, when auth is active, syncs newly available API metadata.
- **Download missing** downloads catalog items that are known but do not have a local file.
- **Retry errors** retries items whose previous media download failed.
- **Generate thumbnails** creates local poster JPGs for downloaded videos when `ffmpeg` is available.
- **Verify library** hashes local media, refreshes file sizes, marks duplicate catalog items, and reports orphan files in the media directory.
- **Cancel** appears while a sync, download, thumbnail, or verification job is running and stops after the current API page or file finishes.
- **Full API rescan** scans the API from page 1.
- **Export catalog** downloads the current catalog as JSON.
- **Create backup** writes a timestamped catalog snapshot under `_catalog_backups`.
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
