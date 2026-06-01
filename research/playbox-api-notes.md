# Playbox API Notes

Source capture:

- `output/har/playbox-gallery.har` captured on 2026-06-01 around 02:54 UTC.
- The HAR appears to omit sensitive request headers and cookies. The app bundle in the same HAR shows the expected auth headers and refresh behavior, so auth notes below distinguish observed HAR data from bundle-inferred behavior.
- Do not commit raw HAR-derived tokens, cookies, or signed media URL query strings. The examples below redact `Authorization`, cookies, access tokens, and CDN `token` query values.

## Summary

Playbox is a better fit for an offline gallery/download integration than for a GeneratePorn-style creation integration right now. The capture shows the private user gallery as paginated collections:

```http
GET https://api.playbox.com/api/model/collections?page=1&filter=ALL
Origin: https://www.playbox.com
Referer: https://www.playbox.com/
Authorization: Bearer [access token]
```

The response contains collection records with nested `input`, `midProcessMedia`, and `output` objects. Completed outputs are signed Bunny CDN URLs on hosts such as:

- `playbox-uploads.b-cdn.net`
- `playbox-videos.b-cdn.net`
- `playbox-storage.b-cdn.net`

The signed media URLs in this capture had `expires=1780284584`, which is `2026-06-01T03:29:44.000Z`, about 35 minutes after the gallery page loaded. Sync should fetch a page, enqueue/download its assets immediately, and not assume stored remote URLs remain usable across later runs.

## Auth Shape

The bundled Playbox client defines three Axios clients:

```text
https://api.playbox.com/auth  -> login, logout, refresh token
https://api.playbox.com/api   -> authenticated product APIs
https://api.playbox.com/      -> a small root client that adds X-MY-CSRF-PROTECTION: 5
```

Observed/inferred behavior:

- `GET /api/users/me-new` bootstraps the logged-in session and returns `{ user, accessToken }`.
- The returned `accessToken` is a JWT. In this capture it was issued at `2026-06-01T02:54:44.000Z` and expired at `2026-06-01T04:54:44.000Z`, so the access token lifetime appears to be 2 hours.
- Authenticated `/api/*` calls use `Authorization: Bearer <accessToken>`.
- The `/api` client also uses `withCredentials: true`, and the `/auth/refresh-token` call uses `withCredentials: true`, implying a browser cookie-backed refresh session.
- On a `401`, the client calls `GET /auth/refresh-token`, reads a fresh `accessToken`, updates Redux state, and retries the failed request.
- The token appears to live in Redux runtime state, not reliably in localStorage. The bundle defines localStorage constants, but the active auth reducer stores the token in memory.
- The HAR did not include `Cookie` or `Authorization` request headers, most likely because the DevTools export was made without sensitive headers/cookies. The API responses still reveal the flow clearly enough to design auth capture.

### Best Auth Capture Approach

Use an imported request from the user's normal Chrome profile when the server-owned Chrome profile fails Cloudflare:

1. Sign into `https://www.playbox.com/collection` in the user's normal Chrome profile.
2. In DevTools Network, choose **Copy as cURL** on a successful `api.playbox.com` request, preferably `/api/users/me-new` or `/auth/refresh-token`.
3. Paste the cURL command into **Settings > Playbox Auth**.
4. Parse and store the request's cookie/header state in `MEDIA_DIR/_playbox_auth_session.json`.
5. Immediately validate the imported session by calling `/auth/refresh-token`, falling back to `/api/users/me-new`, with the imported cookies but without relying on a copied bearer token.
6. Capture only the current `accessToken` in memory and merge any `Set-Cookie` rotation back into the stored cookie jar.

This avoids persisting short-lived bearer tokens and gives the server a durable refresh path when Playbox accepts the imported cookie jar from Node. The imported session file should be treated as sensitive because it contains browser session cookies.

Fallback auth options:

- A backend-owned persistent Chrome profile can capture tokens via DevTools Protocol, but Cloudflare may reject that profile even when the user's standard Chrome profile works.
- A DevTools Console snippet can fetch `/api/users/me-new` from a normal logged-in Playbox tab and POST the returned `accessToken` to the local app's `/api/playbox/auth/token` endpoint. This avoids an extension but only provides a short-lived token.
- A token-forwarding extension could intercept `Authorization` headers from Playbox API requests and POST them to the local app. This is less robust because the token lives in app memory.
- Environment variables such as `PLAYBOX_AUTHORIZATION` and `PLAYBOX_COOKIE` would work for debugging, but they are brittle and easier to leak.
- If another HAR is needed, export with sensitive headers/cookies enabled, then immediately redact it into a focused summary.

## Captured API Requests

### Current User

```http
GET /api/users/me-new
Host: api.playbox.com
Origin: https://www.playbox.com
Referer: https://www.playbox.com/
```

Response shape:

```json
{
  "message": "User found",
  "data": {
    "user": {
      "_id": "[redacted-user-id]",
      "username": "[redacted]",
      "userId": "[redacted]",
      "credits": 2365,
      "countryCode": "AU",
      "subscription": {
        "name": "Premium",
        "startDate": "2026-06-01T02:20:23.489Z",
        "endDate": "2027-06-01T02:20:23.489Z",
        "isActive": true,
        "period": "YEARLY",
        "creditsMonthly": 3000,
        "topUpCredits": 600
      }
    },
    "accessToken": "[jwt redacted]"
  }
}
```

Use this as the auth bootstrap probe and user/account identity source.

### Private Collections / Gallery

```http
GET /api/model/collections?page=1&filter=ALL
Host: api.playbox.com
Origin: https://www.playbox.com
Referer: https://www.playbox.com/
Authorization: Bearer [access token]
```

Observed response metadata:

```json
{
  "message": "Collections found",
  "data": ["...collection objects..."],
  "maxReached": true,
  "total": 13,
  "perPage": 30,
  "page": "1"
}
```

Supported query parameters from the client bundle:

- `page`: 1-based page number.
- `filter`: observed as `ALL`.
- `search`: optional search string.
- `modelId`: optional model-specific gallery filter, via the same endpoint.

Pagination should continue while `maxReached` is false. The response returns `perPage` and `total`, but `maxReached` is the most direct stop condition.

### Collection Object Shape

Representative fields:

```json
{
  "_id": "6a1cf290af0850a33d300f06",
  "name": "Example Video",
  "user": "[redacted-user-id]",
  "model": "69beb512fa3571573d7bfd18",
  "modelName": "PB_USER_NEW_TEMPLATE_5532",
  "status": "COMPLETED",
  "isPublic": false,
  "isPinned": false,
  "customPrompt": "",
  "nudify": false,
  "upscale": false,
  "audio": true,
  "input": {
    "type": "IMAGE",
    "image": {
      "url": "https://playbox-uploads.b-cdn.net/media2/[user-id]/[input].jpg?token=[redacted]&expires=1780284584",
      "resizedImage": {
        "url": null,
        "width": 1152,
        "height": 1728
      }
    },
    "video": {
      "url": null
    }
  },
  "midProcessMedia": {
    "audio": {
      "url": "https://playbox-videos.b-cdn.net/[user-id]/audio....mp3"
    }
  },
  "output": {
    "type": "VIDEO",
    "resolution": "MEDIUM",
    "fps": 30,
    "videoDuration": 10,
    "video": {
      "url": "https://playbox-uploads.b-cdn.net/media2/[user-id]/[output].mp4?token=[redacted]&expires=1780284584"
    },
    "image": {
      "url": null
    }
  },
  "pricing": {
    "total": 75,
    "model": 30,
    "audio": 5,
    "outputDuration": 40
  },
  "seed": 9958931,
  "createdAt": "2026-06-01T02:46:40.669Z",
  "updatedAt": "2026-06-01T02:52:21.216Z",
  "modelType": "GENERATE_VIDEO",
  "modelRating": 6.32
}
```

Observed statuses in the capture:

- `COMPLETED`
- `IN_PROGRESS`

Observed output types:

- `VIDEO`
- `IMAGE`

Downloadable asset candidates:

- Primary output video: `output.video.url`.
- Optional compressed video: `output.video.compressedUrl`.
- Optional poster: `output.video.posterUrl`.
- Primary output image: `output.image.url`.
- Optional/generated audio: `midProcessMedia.audio.url`.
- Input source image/video: `input.image.url`, `input.image.resizedImage.url`, or `input.video.url` if we decide to archive sources as well as outputs.

For an offline sync, the primary artifact should be `output.video.url` or `output.image.url`. Audio and source assets are useful secondary artifacts because Playbox can produce separate audio files and because signed source URLs also expire.

### Collection Details

The client bundle has a detail call:

```http
GET /api/model/{collectionId}
```

This was not present in the gallery HAR, so the list endpoint is currently the authoritative captured source. If later implementation needs richer details, capture opening a single collection/detail modal.

### Folders

```http
GET /api/model/folders
```

Observed response:

```json
{
  "message": "Folders found",
  "data": []
}
```

The bundle also exposes:

```http
POST   /api/model/folder
DELETE /api/model/folder/{folderId}
PUT    /api/model/folder/{folderId}
PUT    /api/model/folder
```

Folder writes are not needed for offline sync.

### Subscription Catalog

```http
GET /api/subscription/
Host: api.playbox.com
X-MY-CSRF-PROTECTION: 5
```

This endpoint returns public subscription plan metadata. It is not needed for gallery sync, except possibly to show account plan information.

### Explore/Public Collections

```http
GET /api/model/explore/?page=1
```

This returns public/explore collections and categories, not the user's private gallery. Do not use it for personal sync.

## Download Strategy

Recommended sync loop:

1. Ensure an in-memory access token via `GET /api/users/me-new` or refresh.
2. Fetch `GET /api/model/collections?page=N&filter=ALL`.
3. Upsert collection metadata.
4. For each collection, collect downloadable assets from the fields listed above.
5. Download assets immediately because CDN signatures expire quickly.
6. Continue pages until `maxReached === true` or an empty `data` array.
7. On `401`, refresh once through the persistent browser profile and retry the page.

Media downloads should preserve the signed URL only as transient request input. Store the remote URL without query parameters, the original signed URL expiration if useful for diagnostics, and the downloaded local file metadata.

## Storage Recommendation

Use separate Playbox storage rather than forcing Playbox collections into the existing GeneratePorn job shape.

Reasoning:

- GeneratePorn's core unit is a job with a single `output_url`.
- Playbox's core unit is a collection with nested input, mid-process media, output media, folders, pricing, model metadata, and possibly multiple asset URLs.
- Signed CDN URLs expire quickly, so a Playbox record needs asset-level download state rather than one item-level `outputUrl`.
- The UI can still render Playbox media through the shared catalog/gallery model after normalization.

Suggested tables:

```text
playbox_collections
  id TEXT PRIMARY KEY
  account_id TEXT
  name TEXT
  status TEXT
  model_id TEXT
  model_name TEXT
  model_type TEXT
  output_type TEXT
  created_at TEXT
  updated_at TEXT
  collection_json TEXT NOT NULL

playbox_assets
  id TEXT PRIMARY KEY              -- stable hash of collection id + asset kind + remote path
  collection_id TEXT NOT NULL
  kind TEXT NOT NULL               -- output-video, output-image, poster, audio, input-image, resized-input
  remote_url_base TEXT
  remote_url_expires_at TEXT
  content_type TEXT
  local_file TEXT
  size INTEGER
  sha256 TEXT
  downloaded_at TEXT
  download_error TEXT
```

If implementation time is tight, a narrower first version can store a normalized `CatalogItem` for each primary output in the existing `media_items` table with provider-specific fields such as `provider: "playbox"`, `collectionId`, `assetKind`, and `rawCollection`. That is faster, but a separate table will age better if we add source/audio/poster archiving, folder filters, or provider-specific sync status.

## Implementation Notes

- Add Playbox-specific config names rather than reusing GeneratePorn env vars:
  - `PLAYBOX_AUTHORIZATION`
  - `PLAYBOX_COOKIE`
  - `PLAYBOX_EXTRA_HEADERS_JSON`
  - `PLAYBOX_AUTH_BROWSER_PROFILE_DIR`
- Use `Origin: https://www.playbox.com` and `Referer: https://www.playbox.com/` for API calls.
- Use `User-Agent` matching the browser profile when possible.
- Treat the browser profile and raw HAR as sensitive material.
- Redact `accessToken`, `Authorization`, cookies, and CDN `token` parameters in logs.
- Consider a provider abstraction at the sync boundary, but avoid abstracting creation flows because Playbox creation is explicitly out of scope.
