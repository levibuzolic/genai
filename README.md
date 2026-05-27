# Local Media Library

Local-only Node.js web app for syncing generated media metadata, downloading media files to disk, and browsing the local collection with prompt text.

The companion Chrome extension, **GP Auth Helper**, only forwards a fresh browser auth token to the local server. All media sync and downloading happens in the Node app.

## Requirements

- [mise](https://mise.jdx.dev/) for the pinned Node.js and pnpm versions
- Chrome, for the unpacked auth helper extension
- A logged-in browser session on the source site

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

The server stores downloaded files in `media/` by default. It also writes the local catalog to:

```text
media/catalog.json
```

Catalog backups are stored beside the catalog:

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

The remote drive should be mounted before starting the server. `catalog.json` lives in the same directory as the downloaded media so the library can stay separate from the project checkout.

## Configuration

Copy `.env.example` to `.env` if you want to change defaults:

```sh
cp .env.example .env
```

Useful settings:

- `PORT`: local web server port, defaults to `5177`
- `MEDIA_DIR`: download/catalog directory, defaults to `media`; absolute and `~` paths are supported
- `GENERATEPORN_PAGE_LIMIT`: max API pages to scan
- `GENERATEPORN_AUTHORIZATION`: optional short-lived fallback bearer token

Prefer the Chrome extension for auth. Static tokens expire quickly.

## Auth Helper Extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `extension/` directory.
5. Visit the source site while logged in.
6. Keep that tab open while syncing from the local app.

The extension refreshes auth every 30 seconds while the logged-in tab is open. You can also press **Send auth to local app** to force an immediate refresh.

The local server keeps the token in memory only. It is not written to `.env` or `media/catalog.json`.

## Using The App

In the local web UI:

- **Sync & download missing** downloads known missing files and, when auth is active, syncs newly available API metadata.
- **Download missing** downloads catalog items that are known but do not have a local file.
- **Retry errors** retries items whose previous media download failed.
- **Generate thumbnails** creates local poster JPGs for downloaded videos when `ffmpeg` is available.
- **Verify library** hashes local media, refreshes file sizes, marks duplicate catalog items, and reports orphan files in the media directory.
- **Cancel** appears while a sync, download, thumbnail, or verification job is running and stops after the current API page or file finishes.
- **Full API rescan** scans the API from page 1.
- **Export catalog** downloads the current `catalog.json`.
- **Create backup** writes a timestamped catalog snapshot under `_catalog_backups`.
- **Restore backup** restores a selected snapshot and first creates a `before-restore` backup of the current catalog.
- Search and filters are stored in the URL so reloads preserve your place.
- Use media/status filters, including duplicates and unverified files, sort order, page size, and grid/list view to browse larger collections.
- Each item has a **Copy prompt** button.

Videos use local poster thumbnails when available. Without a poster, videos are rendered with `preload="metadata"`; with a poster, they use `preload="none"` to avoid eagerly loading video files in the gallery.

Verification stores `sha256`, `fileSize`, and `verifiedAt` on catalog items. Duplicate groups are marked with `duplicateGroupSize` and `duplicateOf`; files in `MEDIA_DIR` that do not map to a catalog item are listed in `catalog.json` under `orphanFiles`.

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
