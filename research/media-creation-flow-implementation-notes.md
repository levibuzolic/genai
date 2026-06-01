# Media Creation Flow Implementation Notes

These notes are based on the final captured API shapes in `research/generateporn-api-notes.md`, including the custom image/video captures under `output/har/`, and the current local media-library app.

## Product Goal

Add a creation workspace to the local app where a user can start an image edit or video generation from:

- an image already in the local collection
- an uploaded image file
- a remote image URL

The flow should expose every captured API capability through one creation workspace instead of separate one-off screens.

## Current App Fit

The app is currently a catalog-first browser:

- `src/server.js` syncs historical jobs, downloads completed media, and exposes local catalog APIs.
- `public/index.html`, `public/app.js`, and `public/styles.css` provide a vanilla JS gallery and item details dialog.
- Catalog items already store enough creation context to seed new work: `id`, `type`, `prompt`, `negativePrompt`, `inputUrl`, `outputUrl`, `localFile`, `status`, and `externalTaskId`.
- Detail dialogs already have the most natural entry point for "use this image as source".

Creation should be added as a new local app concern, not bolted onto sync state. Sync/download jobs are catalog maintenance; creation jobs need their own state, polling, errors, and result import.

## Captured API Surface

Known job creation endpoints:

- `POST https://api.generateporn.ai/api/jobs/edit`
- `POST https://api.generateporn.ai/api/jobs/video`
- `GET https://api.generateporn.ai/api/jobs/{job_id}` for polling both image and video jobs
- `GET https://api.generateporn.ai/api/me` after submit/completion if account state is shown

Known source forms:

- Edit upload: `image_base64: "data:image/...;base64,..."`
- Edit URL/custom image URL: `input_url: "https://..."` and `prompt`
- Custom video upload: `image_base64: "data:image/...;base64,..."`, `prompt`, `resolution`, `duration`, and `seed: null` per bundle inspection
- Template video upload: supported; treat uploaded data URLs with the same image upload policy as Custom Video rather than copying the earlier failed `input_url` data-URL request shape
- Video URL/custom video URL: `input_url: "https://..."`, `prompt`, `resolution`, `duration`, and `seed: null`
- Existing collection item: should prefer `outputUrl` when available; use the local file as a data URL fallback

Known mode fields:

- Custom Image/Edit: `prompt` plus exactly one source field; the 2026-06-01 HAR shows no `seed`, `modelId`, or aspect-ratio field for edit jobs
- Nudify preset: edit endpoint with a fixed prompt
- Blowjob video template: fixed `prompt`, fixed `negative_prompt`, `resolution: "720p"`, `duration: 4`
- Custom Video (I2V): user `prompt` + image source + `modelId` (new in 2026-05), selected `resolution`/`duration` (model-dependent subsets), optional `seed`
- New pure Text-to-Video (T2V): `modelId` (e.g. "wan2.7-t2v") + `prompt` only (no image), resolution, duration, seed. No source picker.
- Poll result: `id`, `type`, `input_url`, `prompt`, `negative_prompt`, `resolution`, `duration`, `seed`, `external_task_id`, `output_url`, `status`, `coin_cost`, `error`
- Fresh edit poll responses also include `model_id: "qwen-image-2.0-pro"` and may use `https://generations.generateporn.ai/generations/{job_id}.png` for image outputs.

Captured custom video quality mapping (pre-2026-05-30 models):

- `720p · 4s` -> `resolution: "720p"`, `duration: 4`
- `720p · 8s` -> `resolution: "720p"`, `duration: 8`
- `1080p · 10s` -> `resolution: "1080p"`, `duration: 10`
- `1080p · 15s` -> `resolution: "1080p"`, `duration: 15`

**2026-05-30/31 update**: The platform introduced explicit multi-model video generation with an authoritative client-side config (discovered in the JS bundle in `new-video-models-generate-initial-page-load-2.har`). `spicy-mode.har` later confirmed the additional `wan2.7-i2v-spicy` I2V model.

See the full model definitions and precise supported (resolution × duration) matrix in:
- `research/video-models-config.json` (clean reference)
- `research/generateporn-api-notes.md` → "Authoritative Video Model Configuration (extracted from JS bundle)" section

Key models:
- I2V: `wan2.7-i2v`, `wan2.7-i2v-spicy`, `wan2.6-i2v-flash` (full 720p/1080p + 4/8/10/15s), `wan2.2-i2v-plus` (1080p only, fixed 5s)
- **Pure T2V (no image)**: `wan2.7-t2v` (full range, `protocol: "t2v"`)

The local creation system should model these exactly (including `protocol`, `fixedDuration`, `audio` flags, and `tier`).

Job responses now echo `model_id`. See full details in `research/generateporn-api-notes.md` ("New Video Models" section). The local creation system needs per-model quality/duration option lists and a dedicated source-less T2V mode.

Captured behavior:

- Poll about every 2 seconds.
- Image edit jobs completed in roughly 20-35 seconds in the captures.
- Captured video jobs completed in roughly 3 minutes.
- Video URL source succeeded.
- Template videos can use either uploaded images or URL sources. Earlier failed captures sent an uploaded data URL under `input_url`; the implementation should route uploaded template sources through the safer `image_base64` upload policy.

The final custom captures resolved the earlier uncertainty around URL-mode edit requests: URL mode sends `input_url` directly and does not convert the URL to base64 before submit.

## Proposed UX

Add a top-level `Create` button and a `Create from this image` action in the item detail dialog for image items.

The creation workspace should have four stable regions:

- Source picker: Collection, Upload, URL
- Mode picker: Custom Image, Nudify preset, Custom Video, captured video templates
- Parameters: mode-specific controls generated from a mode schema
- Result panel: queued/running/done/error state with preview, output URL, job ID, copy/open/download/import actions

For collection sources:

- show only image-capable items, since the captured API uses source images
- default to the selected detail item when launched from a media card
- use `item.outputUrl` as the API source when present
- if there is no `outputUrl` but `localFile` exists, let the server convert the local file to a data URL
- for Custom Video, local-file fallback should use `image_base64`
- for template video modes, local-file fallback should also use `image_base64`

For upload sources:

- accept `image/jpeg,image/png,image/webp,image/bmp`, matching the captured UI
- convert to a data URL server-side or client-side; server-side is easier to test and keeps request shaping centralized
- show dimensions and file size before submit if practical
- use `image_base64` for image edit, Nudify, Custom Video, and template video uploads
- do not use the captured home-page template behavior of sending an uploaded data URL under `input_url`

For URL sources:

- require a valid `https://` URL
- pass the URL directly for video
- pass the URL directly for edit as `input_url`

Recommended first-screen workflow:

- The top-level `Create` button opens Custom Image with the source picker empty.
- `Create from this image` opens the same workspace with the source prefilled from the selected catalog item.
- After a successful image result, offer `Animate this` and prefill Custom Video with the new `outputUrl`, matching the captured `Animate this with Wan 2.7 Video` path.

## Proposed Local API

Keep the browser UI talking only to local endpoints. The local server should own auth headers, API base URL, request shaping, polling, and catalog updates.

Suggested endpoints:

```text
GET  /api/create/modes
POST /api/create/jobs
GET  /api/create/jobs/{id}
POST /api/create/jobs/{id}/download
```

`GET /api/create/modes` returns the mode registry the UI should render. This lets captured templates and future custom modes be added without scattering options across the frontend.

`POST /api/create/jobs` accepts a normalized local request:

```json
{
  "modeId": "edit",
  "source": {
    "kind": "catalog",
    "itemId": "..."
  },
  "params": {
    "prompt": "..."
  }
}
```

Other source examples:

```json
{ "kind": "upload", "fileToken": "..." }
{ "kind": "url", "url": "https://example.com/image.png" }
```

The server maps that normalized request to the live API shape:

- edit upload/catalog-file fallback: `{ "image_base64": "...", "prompt": "..." }`
- edit URL/catalog-output URL: `{ "input_url": "...", "prompt": "..." }`
- custom video upload/catalog-file fallback: `{ "image_base64": "...", "prompt": "...", "resolution": "...", "duration": 4, "seed": null }`
- custom video URL/catalog-output URL: `{ "input_url": "...", "prompt": "...", "resolution": "...", "duration": 4, "seed": null }`
- video template upload/catalog-file fallback: `{ "image_base64": "...", "prompt": "...", "negative_prompt": "...", "resolution": "...", "duration": 4 }`
- video template URL/catalog-output URL: `{ "input_url": "...", "prompt": "...", "negative_prompt": "...", "resolution": "...", "duration": 4 }`

`GET /api/create/jobs/{id}` should proxy the live job status and normalize snake_case fields to the app's existing camelCase catalog shape.

`POST /api/create/jobs/{id}/download` should reuse the existing download/catalog path once a job is `done`. It can either fetch the live job by ID and call the same internal conversion/download helpers, or accept a previously polled normalized job payload.

## Mode Registry Shape

Represent every creation feature as a mode definition. The mode registry should be the source of truth for UI controls, validation, and API request shaping:

```json
{
  "id": "blowjob-video",
  "label": "Blowjob",
  "mediaType": "video",
  "endpoint": "video",
  "source": {
    "required": true,
    "acceptedKinds": ["catalog", "upload", "url"],
    "preferRemoteUrl": true
  },
  "fields": [
    { "name": "resolution", "type": "select", "options": ["720p"], "default": "720p" },
    { "name": "duration", "type": "number", "default": 4 }
  ],
  "apiTemplate": {
    "prompt": "...",
    "negative_prompt": "...",
    "resolution": "{{resolution}}",
    "duration": "{{duration}}"
  }
}
```

Suggested built-in mode entries:

- `custom-image`: endpoint `edit`, editable prompt, URL/data source, sends no `seed`
- `nudify`: endpoint `edit`, fixed prompt `Remove all clothing, fully nude, keep face and pose unchanged`
- `custom-video`: endpoint `video`, editable prompt, quality select with the four captured resolution/duration labels, sends `seed: null`
- `blowjob-video`: endpoint `video`, fixed template prompt, fixed negative prompt, `720p`, `4`

Do not limit this to the built-in templates. Add a local custom-template registry that can hold many user-defined templates:

```json
{
  "id": "blowjob-video",
  "label": "Blowjob",
  "endpoint": "video",
  "mediaType": "video",
  "prompt": "...",
  "negativePrompt": "...",
  "resolution": "720p",
  "duration": 4,
  "sourcePolicy": "image",
  "seedJobId": "fb62d491-b377-4c24-92ac-98e02e305bce"
}
```

Template prompts should be sourced from history/catalog data instead of manually copying from UI text. The history endpoint `GET /api/jobs?type=all&page=N` returns list items with original `prompt` and `negative_prompt`; for example, `fb62d491-b377-4c24-92ac-98e02e305bce` is a known successful Blowjob template job that can seed the first built-in template. Store the prompt in a local ignored/private template config if it should not be committed.

For mode definitions, the registry should support:

- fixed hidden fields from captures
- user-editable fields
- default values
- option lists
- validation rules
- source requirements
- feature flags for `captured`, `risky`, and `disabled` modes
- API request field policy, because upload/data-URL sources should use `image_base64` for edit, Custom Video, and template video modes, while URL/remote sources use `input_url`

This avoids hardcoding Nudify, templates, and custom modes as separate frontend workflows.

## Request Shaping Rules

Source resolution should happen before mode request shaping:

1. If source kind is `catalog` and the item has `outputUrl`, use that remote URL.
2. If source kind is `catalog` and only `localFile` is available, convert the local image to a data URL.
3. If source kind is `upload`, convert the file to a data URL.
4. If source kind is `url`, pass the validated URL through.

Then shape by endpoint and source value:

- `edit` with data URL: send `image_base64`.
- `edit` with remote URL: send `input_url`.
- `custom-video` with data URL: send `image_base64`.
- `custom-video` with remote URL: send `input_url`.
- `template-video` with data URL: send `image_base64`.
- `template-video` with remote URL: send `input_url`.
- Include `seed: null` for custom video and text-to-video parity with the captured app. Do not include `seed` for edit-image jobs.
- Include `negative_prompt` only for modes that captured one; custom video omitted it and polling returned `negative_prompt: null`.

The failed Blowjob upload captures should not be copied for our implementation. They sent uploaded data URLs under `input_url`; the app should use `image_base64` for uploaded files and `input_url` for remote URLs across both custom video and template video modes.

## Catalog Integration

When a created job finishes:

- show the generated media immediately from `outputUrl`
- offer `Download to library`
- optionally auto-download if a setting is enabled later
- insert or merge the normalized job into `catalog.items`
- reuse `downloadJob`, `toCatalogItem`, `buildFilename`, thumbnail generation, and duplicate verification behavior where possible

Catalog records should preserve creation lineage:

```json
{
  "sourceItemId": "...",
  "sourceKind": "catalog",
  "createModeId": "edit",
  "createdLocallyAt": "..."
}
```

That lineage would make it possible to filter derivative work, continue edit chains, and debug failed generations.

## Implementation Phases

1. Add a creation service in `src/server.js` or split a small `src/create.js` module once the code starts to grow.
2. Add source resolution helpers: catalog item to remote URL, catalog item to data URL, upload token to data URL, direct URL validation.
3. Add local creation endpoints and tests for request shaping, auth errors, API submit errors, and polling normalization.
4. Add a mode registry with the captured modes and quality options.
5. Add a minimal UI with source picker, mode picker, params form, submit, poll, and result preview.
6. Add `Create from this image` in the detail dialog for image items.
7. Add `Animate this` from completed image results into Custom Video.
8. Add custom template storage/import from a known history job ID.
9. Add download/import of completed jobs into the catalog.

## Remaining Risks

- `Nudify First` on video templates was visible in the captured UI but not submitted. Keep it disabled or omit it until there is a request body for that option.
- Failure polling shape for jobs that return an ID and later fail is still not represented; captured failures were submit-time `500 {"error":"submission_failed"}` with no job ID.
- `priority`, `shared`, and `favorited` appear in poll/history responses; there is no captured evidence that they are accepted on creation.
- `seed` is sent as `null` for custom video and text-to-video, but no non-null seed capture exists yet. Edit-image jobs should omit `seed`.
- Custom Video upload with `image_base64` is inferred from bundle inspection rather than a live HAR. It is still the right implementation shape to use unless a later capture disproves it.
- Template prompts need a private/local source of truth. Use history jobs by known ID to seed them, then store the resulting templates in local config.

## Near-Term Recommendation

Build the first version around a generic creation job runner and mode registry, with these enabled modes:

- Custom Image/Edit with prompt
- Nudify as an edit preset
- Custom Video with the four captured quality options
- Blowjob video template with upload and URL source handling
- Custom template registry seeded from history jobs

Do not create separate bespoke flows for image edit, Nudify, templates, and custom video. The API differences are small enough to handle cleanly through source resolution plus mode request shaping.

Coins should not affect local app behavior because this project uses an unlimited plan. Keep quality labels focused on resolution and duration, not cost.
