# GenAI Auth Helper

Tiny unpacked Chrome extension for local development use. It injects a small, low-profile auth pill on supported provider sites and forwards a fresh bearer token to the local media library at `http://localhost:5177`.

Supported sites:

- `https://app.generateporn.ai/` -> `POST /api/auth/token`
- `https://www.playbox.com/` -> `POST /api/playbox/auth/token`

The extension does not download media. The Node web app handles API sync, catalog updates, and local file downloads.

## Install locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension` directory.
5. Visit a supported site while logged in.
6. Keep that tab open while syncing from the Node web app.

The auth token is refreshed automatically every 30 seconds while the logged-in site tab is open. Press **Sync** only if you want to force an immediate refresh.

## Playbox and Cloudflare

If Playbox's Cloudflare challenge loops inside the app's managed auth browser, use normal Chrome instead:

1. Reload this unpacked extension in `chrome://extensions`.
2. Open `https://www.playbox.com/collection` in your normal Chrome profile.
3. Complete the Playbox login/Cloudflare verification there.
4. Leave the tab open until the extension pill says `Playbox Auth` with a recent time.
5. Run **Sync Playbox** in the local app.

This keeps Cloudflare verification in your regular browser session and only sends the short-lived Playbox API token to the local server.
