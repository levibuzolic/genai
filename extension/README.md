# GP Auth Helper

Tiny unpacked Chrome extension for local development use. It injects a small, low-profile auth pill on `https://app.generateporn.ai/` and forwards a fresh Clerk bearer token to the local media library at `http://localhost:5177`.

The extension does not download media. The Node web app handles API sync, catalog updates, and local file downloads.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension` directory.
5. Visit `https://app.generateporn.ai/` while logged in.
6. Keep that tab open while syncing from the Node web app.

The auth token is refreshed automatically every 30 seconds while the logged-in site tab is open. Press **Sync** only if you want to force an immediate refresh.
