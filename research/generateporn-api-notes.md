# GeneratePorn.ai API Notes

Source captures:

- `image-edit.har` captured on 2026-05-27.
- `output/har/auth-scan.har` captured on 2026-05-27 with an authenticated Playwright Chromium session.
- `output/har/nudify-api-capture.json` is a redacted focused request/response capture for the Nudify submit and polling cycle.
- `output/har/blowjob-video.har` captured on 2026-05-27 for the Blowjob video template. Both submit attempts failed before a job id was returned.
- `output/har/blowjob-video-api-summary.json` is a sanitized summary of the relevant video API requests/responses from that HAR.
- `output/har/blowjob-video-url.har` captured on 2026-05-27 for the Blowjob video template using the modal's URL source field. This submit succeeded and reached `status: "done"`.
- `output/har/blowjob-video-url-api-summary.json` is a sanitized summary of the successful URL-source video run.
- `output/har/blowjob-nudify-first.har` captured on 2026-05-27 for the Blowjob video template using URL source with `Nudify First` enabled.
- `output/har/blowjob-nudify-first-api-summary.json` is a sanitized summary of the two-step Nudify First plus video run.
- `output/har/custom-flows.har` captured on 2026-05-27 for Custom Mode image and video flows.
- `output/har/custom-image-api-summary.json` and `output/har/custom-video-api-summary.json` are sanitized summaries of those custom runs.
- `output/har/new-video-models.har` captured on 2026-05-30 — focused capture of the new multi-model video system (wan2.7-i2v, wan2.6-i2v-flash, wan2.2-i2v-plus, happyhorse-1.0-i2v, and the new pure text-to-video wan2.7-t2v). See dedicated section below.
- `output/har/new-video-models-api-summary.json` — sanitized focused summary of the model-specific video flows, request shapes, and analytics events (recommended reading).
- `output/har/new-video-models-generate-initial-page-load.har` captured ~2026-05-31 — intended to capture initial JS bundles + API calls on /editor and the new /generate (T2V) pages. In practice contained only 14 small entries (Clerk auth, /api/me, /api/auth/sync, /api/jobs?type=all&page=1, plausible/rum). No main document loads or JS bundles were present (likely filtered XHR-only export). Still yielded valuable live job history data. See "Additional findings from initial-page-load HAR" subsection below.
- `output/har/new-video-models-generate-initial-page-load-2.har` (recapture with filtering completely disabled, ~14 MB) — full unfiltered initial page loads for both /editor and the dedicated /generate (pure T2V) route. Includes the main application bundle `assets/index-Der5BJjj.js` (~711 kB decompressed). This was the capture expected to contain the authoritative client-side model configuration and the exact supported (resolution × duration) matrix per model. See new dedicated subsection below.
- `output/har/updated-edit-image-api.har` captured on 2026-06-01 — fresh Edit Image upload submit against the current app bundle. It confirms the edit endpoint now submits only `image_base64` and `prompt` for upload edits, with no `seed`, `modelId`, or aspect-ratio field in the request.
- `output/har/spicy-mode.har` captured on 2026-06-01 — fresh video submit for the new `wan2.7-i2v-spicy` model. It uses the normal I2V `/api/jobs/video` body shape and supports the same quality matrix as Wan 2.7.
- `output/har/generateporn-live-2026-06-03T22-53-22Z.har` captured on 2026-06-03 UTC / 2026-06-04 Melbourne with the app-owned authenticated Chrome profile. This is the current production UI after the "StillHeat" relaunch. It loaded `/`, `/create/generate`, `/create/edit`, and `/create/video`, plus the lazy `CreateFlow-BFRKWFdp.js` chunk.
- `output/har/generateporn-live-2026-06-03T22-53-22Z-api-summary.json` is the sanitized summary for that run. The raw HAR is local/ignored and may contain auth headers; use the summary and bundle extraction for checked-in documentation.
- `output/bundles/generateporn-live-2026-06-03T22-53-22Z-app-bundle.js` contains the current production bundle used for the extracted engine/API registry.
- `research/live-engines-config.json` is the clean current engine/request-shape reference extracted from the live bundle.
- `output/har/generateporn-submit-2026-06-03T23-42-57Z.har` captured successful current-production submissions for text-to-image, edit-image upload, and image-to-video upload. The raw HAR is local/ignored and may contain auth headers and image data URLs.
- `output/har/generateporn-submit-2026-06-03T23-42-57Z-api-summary.json` is the redacted submission summary.

## Current Production Relaunch: StillHeat / MotionHeat

Captured from the authenticated production app on 2026-06-03T22:53Z. This is a major change from the May 30 / June 1 Wan/Qwen model-picker research:

- The old `/editor` and `/generate` routes now redirect to `/`.
- The current create routes are `/create/generate`, `/create/edit`, and `/create/video`.
- The current UI does not expose the Wan/Qwen model IDs (`wan2.7-*`, `qwen-image-*`, `z-image-turbo`) or send `modelId` from the client.
- The old preset cards on the home page are marked `COMING SOON`.
- The visible creation surface is now three branded preview engines:

| Flow | Route | Engine | Job type | Endpoint |
|------|-------|--------|----------|----------|
| Text to image | `/create/generate` | `StillHeat v1.0 Preview` | `text2image` | `POST /api/jobs/text2image` |
| Edit image | `/create/edit` | `StillHeat-EDIT v1.0 Preview` | `edit` | `POST /api/jobs/edit` |
| Image to video | `/create/video` | `MotionHeat v1.0 Preview` | `video` | `POST /api/jobs/video` |

The authenticated page-load capture only called:

```http
POST /api/auth/sync
GET /api/me
```

No model/options endpoint was observed. The engine registry and request builders are client-side in `CreateFlow-BFRKWFdp.js`.

### Current Submit Payloads

Text-to-image now uses a new endpoint:

```http
POST /api/jobs/text2image
```

```json
{
  "prompt": "string",
  "aspectRatio": "3:4",
  "realism": 0.55,
  "seed": 1234567
}
```

Notes:

- Aspect ratio options are `1:1`, `3:4`, `4:3`, and `9:16`.
- `realism` is optional and only sent when the "Realism strength" control is enabled.
- The UI always generates a numeric seed, either random or user-specified.
- Text-to-image creation cost is shown as 30 Amethyst unless the account is unlimited.

Edit image still uses:

```http
POST /api/jobs/edit
```

```json
{
  "image_base64": "data:image/[omitted]",
  "input_url": "https://...",
  "prompt": "string",
  "realism": 0.55,
  "src_width": 1024,
  "src_height": 1024,
  "seed": 1234567
}
```

Notes:

- The current UI exposes upload/drop only, but the builder still supports `input_url` when a source URL is passed through route state.
- `JSON.stringify` omits undefined fields, so a normal upload sends `image_base64` and omits `input_url`.
- Edit creation cost is shown as 60 Amethyst unless the account is unlimited.

Video still uses:

```http
POST /api/jobs/video
```

```json
{
  "image_base64": "data:image/[omitted]",
  "input_url": "https://...",
  "prompt": "string",
  "resolution": "720p",
  "duration": 4,
  "negative_prompt": "string",
  "seed": 1234567
}
```

Notes:

- The current UI requires a source image for video.
- Resolution options are `720p` and `1080p`; `1080p` is disabled unless the plan is in `pro`, `creator`, or `max`.
- Duration is a slider from 4 to 16 seconds, step 1.
- Cost is `12 * duration` for `720p`, `18 * duration` for `1080p`, unless the account is unlimited.
- The optional negative prompt field is capped at 300 characters.

Polling and history remain unchanged:

```http
GET /api/jobs/{job_id}
GET /api/jobs?type={type}&page={page}
POST /api/jobs/{job_id}/favorite
DELETE /api/jobs/{job_id}/favorite
DELETE /api/jobs/{job_id}
```

### Successful Submission Capture

Captured on 2026-06-03T23:42Z with the app-owned authenticated Chrome profile. Three current-production jobs were submitted and all reached `status: "done"`.

Text-to-image:

```http
POST /api/jobs/text2image
```

Request:

```json
{
  "prompt": "Photoreal portrait, soft studio light, neutral expression, cinematic 4K",
  "aspectRatio": "3:4",
  "realism": 0.55,
  "seed": 1462001
}
```

Create response:

```json
{
  "job_id": "b946dfcc-4d84-4961-ba02-e52ec1e2367c"
}
```

Terminal job:

```json
{
  "id": "b946dfcc-4d84-4961-ba02-e52ec1e2367c",
  "type": "text2image",
  "input_url": null,
  "prompt": "Photoreal portrait, soft studio light, neutral expression, cinematic 4K",
  "negative_prompt": null,
  "resolution": "3:4",
  "duration": null,
  "seed": 1462001,
  "external_task_id": "8ebce503-44f6-43fa-9509-acb81a80aca5-e1",
  "output_url": "https://generations.generateporn.ai/generations/b946dfcc-4d84-4961-ba02-e52ec1e2367c.png",
  "status": "done",
  "coin_cost": 0,
  "priority": "normal",
  "shared": false,
  "error": null,
  "created_at": 1780530182,
  "model_id": "stillheat",
  "aspect_ratio": null,
  "refunded_at": null,
  "favorited": false
}
```

Observed polling statuses:

```text
pending x11, done
```

Edit upload:

```http
POST /api/jobs/edit
```

Request:

```json
{
  "image_base64": "data:image/[omitted]",
  "prompt": "Warm cinematic lighting, keep the same composition and natural skin texture",
  "realism": 0.55,
  "src_width": 832,
  "src_height": 1248,
  "seed": 1462002
}
```

Terminal job differences:

```json
{
  "type": "edit",
  "resolution": null,
  "duration": null,
  "seed": 1462002,
  "output_url": "https://generations.generateporn.ai/generations/49b45923-a696-45d1-aed6-165617cd82c6.png",
  "status": "done",
  "model_id": "stillheat-edit",
  "aspect_ratio": null
}
```

Observed polling statuses:

```text
pending x4, done
```

Image-to-video upload:

```http
POST /api/jobs/video
```

Request:

```json
{
  "image_base64": "data:image/[omitted]",
  "prompt": "Slow subtle camera push in, natural breathing, soft lighting",
  "resolution": "720p",
  "duration": 4,
  "negative_prompt": "blur, watermark, extra fingers, distorted face",
  "seed": 1462003
}
```

Terminal job differences:

```json
{
  "type": "video",
  "negative_prompt": "blur, watermark, extra fingers, distorted face",
  "resolution": "720p",
  "duration": 4,
  "seed": 1462003,
  "output_url": "https://generations.generateporn.ai/generations/d4311816-5b62-479e-8f2a-ae4e8e51b9ef.mp4",
  "status": "done",
  "model_id": "motionheat",
  "aspect_ratio": null
}
```

Observed polling statuses:

```text
pending x13, done
```

Common terminal job fields observed across all three current flows:

```json
{
  "id": "uuid",
  "user_id": "[redacted]",
  "type": "text2image | edit | video",
  "input_url": null,
  "prompt": "string",
  "negative_prompt": "string | null",
  "resolution": "3:4 | 720p | null",
  "duration": "number | null",
  "seed": "number",
  "external_task_id": "string",
  "output_url": "https://generations.generateporn.ai/generations/{job_id}.{png|mp4}",
  "status": "pending | done | failed",
  "coin_cost": 0,
  "priority": "normal",
  "shared": false,
  "shared_at": null,
  "error": null,
  "created_at": 1780530182,
  "model_id": "stillheat | stillheat-edit | motionheat",
  "aspect_ratio": null,
  "refunded_at": null,
  "last_polled_at": 1780530215239,
  "favorited": false,
  "favorited_at": null
}
```

Notes:

- `coin_cost` was `0` because the capture account was on an unlimited plan. Non-unlimited accounts should still expect UI-calculated costs described above.
- The text-to-image request field is `aspectRatio`, but the terminal job stores that value in `resolution`; `aspect_ratio` remained `null`.
- Current successful jobs use output URLs on `generations.generateporn.ai/generations/{job_id}.{ext}`.
- The backend assigns `model_id` even though the client sends no `modelId`.

### Current Account / Plan API Observations

The current bundle uses Clerk bearer auth for all API calls and handles these API errors specially:

- `429 concurrency_limit`
- `429 daily_video_limit`
- `429 abuse_suspected`
- `429 ip_free_account_limit`
- `image_engine_unconfigured` from create submit responses

The `/api/me` response still includes:

```json
{
  "coins": 105,
  "allowance_coins": 0,
  "referral_code": "[redacted]",
  "coin_pack_discount": 0.55,
  "relaunch_offer": true,
  "subscription": {
    "plan": "max",
    "status": "active",
    "period_end": 1811679987,
    "allowance_refresh_at": 1782735987
  }
}
```

Implementation impact: the current app should not hard-code the June 1 `modelId` matrix as the only creation surface. A robust local client should support both:

- legacy/observed explicit `modelId` fields from older captures and history rows, and
- the current branded-engine API where the client sends no model ID and the backend chooses the active engine behind `/text2image`, `/edit`, or `/video`.

## Edit Image Flow

Base API origin:

```text
https://api.generateporn.ai
```

The app creates an image edit job with:

```http
POST /api/jobs/edit
Content-Type: application/json
Origin: https://app.generateporn.ai
Referer: https://app.generateporn.ai/
```

Observed request body from the fresh 2026-06-01 upload capture:

```json
{
  "image_base64": "data:image/jpeg;base64,[omitted]",
  "prompt": "[user prompt]"
}
```

Observed response:

```json
{
  "job_id": "377c0d8c-955a-49bb-a91d-82e255225d67"
}
```

The same endpoint can send either `image_base64` or `input_url`, depending on how the source image was provided:

```json
{
  "input_url": "https://...",
  "prompt": "..."
}
```

Important capture note: the original edit HAR used `image_base64`. The later Custom Image capture confirmed URL mode sends `input_url` directly. The 2026-06-01 capture indicates Edit Image requests should not include `seed: null`; use only `prompt` plus the source field.

The terminal poll response in the fresh capture returned a generated asset URL on the newer generations host and exposed the model in response metadata:

```json
{
  "id": "377c0d8c-955a-49bb-a91d-82e255225d67",
  "type": "edit",
  "input_url": null,
  "output_url": "https://generations.generateporn.ai/generations/377c0d8c-955a-49bb-a91d-82e255225d67.png",
  "status": "done",
  "model_id": "qwen-image-2.0-pro",
  "aspect_ratio": null
}
```

## Nudify Flow

UI path:

1. Open the home/create screen at `https://app.generateporn.ai/`.
2. Select the `Nudify` image template card.
3. The modal shows `SOURCE IMAGE`, source mode tabs `Upload` and `URL`, a hidden file input, a `RESULT` panel, and a `NUDIFY FREE` submit button.

Observed upload input:

```html
<input type="file" accept="image/jpeg,image/png,image/webp,image/bmp">
```

Capture input:

```text
/Users/levi/src/levibuzolic/genai/media/2026-05-25/2026-05-25_edit_a1c2eebf-0575-4bb8-b7ef-218dd5f479e3.png
PNG, 1800 x 2400, 4.4 MB
```

Despite the UI tool being named `Nudify`, the API call uses the generic edit endpoint:

```http
POST /api/jobs/edit
Content-Type: application/json
Origin: https://app.generateporn.ai
Referer: https://app.generateporn.ai/
```

Observed request body:
```json
{
  "image_base64": "data:image/png;base64,[omitted; 6156094 chars in capture]",
  "prompt": "Remove all clothing, fully nude, keep face and pose unchanged"
}
```

Observed response:

```json
{
  "job_id": "1f953621-9aa0-430c-8d97-5ee60d24f86e"
}
```

The submitted Nudify job still returns as `type: "edit"` in job polling responses. There was no separate `/api/jobs/nudify` endpoint observed in this capture.

## Nudify Job Polling

After submit, the UI polls:

```http
GET /api/jobs/1f953621-9aa0-430c-8d97-5ee60d24f86e
```

Observed polling result statuses:

```text
pending, pending, pending, pending, pending, pending, pending, pending, done
```

Observed timing:

```text
First poll response: 2026-05-27T13:54:22.824Z
Done poll response:  2026-05-27T13:54:39.160Z
Submit-to-done time: ~21.7 seconds
```

Pending response shape:

```json
{
  "id": "1f953621-9aa0-430c-8d97-5ee60d24f86e",
  "type": "edit",
  "input_url": null,
  "prompt": "Remove all clothing, fully nude, keep face and pose unchanged",
  "negative_prompt": null,
  "resolution": null,
  "duration": null,
  "seed": null,
  "external_task_id": "0307c40e-514f-43c0-b75c-bbe824600dd6",
  "output_url": null,
  "status": "pending",
  "coin_cost": 0,
  "error": null,
  "created_at": 1779890061,
  "shared": false,
  "shared_at": null,
  "priority": "normal",
  "favorited": false,
  "favorited_at": null
}
```

Done response changes:

```json
{
  "status": "done",
  "output_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png"
}
```

As with the edit flow, the output URL is on `mule-router-assets.muleusercontent.com` and uses the `external_task_id` as the asset directory.

## Blowjob Video Flow

UI path:

1. Open the home/create screen at `https://app.generateporn.ai/`.
2. Select the `Blowjob` video template card.
3. The modal shows `SOURCE IMAGE`, source mode tabs `Upload` and `URL`, a hidden file input, a `RESULT` panel, an optional `Nudify First (free with PRO)` control, and a `GENERATE VIDEO FREE` submit button.

Observed upload input:

```html
<input type="file" accept="image/jpeg,image/png,image/webp,image/bmp">
```

The `Nudify First (free with PRO)` control was present but was not clicked for this capture. It appeared as a button-like control rather than a native checkbox in the DOM.

The app submits the video template with:

```http
POST /api/jobs/video
Content-Type: application/json
Origin: https://app.generateporn.ai
Referer: https://app.generateporn.ai/
```

Observed request body shape:

```json
{
  "input_url": "data:image/png;base64,[omitted]",
  "prompt": "[fixed Blowjob template prompt omitted]",
  "negative_prompt": "slow motion, morphing, distorted face, hands merging with skin, extra fingers, cartoonish, low resolution, disconnected body parts, blurry, jittery, static",
  "resolution": "720p",
  "duration": 4
}
```

Important capture note: this home-page video template flow uses the field name `input_url` even when the uploaded source image is a `data:image/png;base64,...` data URL. That differs from edit uploads, and also appears to differ from the Custom Video editor code path described in [File Upload Debugging](#file-upload-debugging).

Two non-thumbnail PNG inputs were tried:

```text
Attempt 1: media/2026-05-25/2026-05-25_edit_a1c2eebf-0575-4bb8-b7ef-218dd5f479e3.png
PNG, 1800 x 2400, 4.4 MB
Request content-length: 6156849
Base64 data URL chars: 6156094

Attempt 2: media/2026-05-26/2026-05-26_edit_023ded4b-341e-4ddc-854d-6c66bd696228.png
PNG, 1152 x 1728, 2.4 MB
Request content-length: 3287165
Base64 data URL chars: 3286410
```

Both attempts returned:

```http
HTTP/2 500
Content-Type: application/json
```

```json
{
  "error": "submission_failed"
}
```

The UI displayed:

```text
Generation failed.
Coins refunded if charged.
```

No `job_id` was returned for either attempt, so no `GET /api/jobs/{job_id}` polling occurred in this capture. Based on later bundle inspection, this is most likely a template-modal serialization issue: the uploaded file was sent as a data URL in `input_url`, while other upload paths use `image_base64`.

## Blowjob Video URL Source Success

Using the modal's `URL` source tab instead of uploading a local file succeeded. The source URL used was the output image from the Nudify run:

```text
https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png
```

UI behavior:

1. Select `Blowjob`.
2. Click the `URL` tab.
3. Fill the visible `input[type=url]` whose placeholder is `https://example.com/image.jpg`.
4. Click `Use`.
5. `GENERATE VIDEO FREE` becomes enabled.
6. Submit without clicking `Nudify First (free with PRO)`.

Observed successful request:

```http
POST /api/jobs/video
Content-Type: application/json
Origin: https://app.generateporn.ai
Referer: https://app.generateporn.ai/
```

Observed request body shape:

```json
{
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "prompt": "[fixed Blowjob template prompt omitted]",
  "negative_prompt": "slow motion, morphing, distorted face, hands merging with skin, extra fingers, cartoonish, low resolution, disconnected body parts, blurry, jittery, static",
  "resolution": "720p",
  "duration": 4
}
```

Observed response:

```json
{
  "job_id": "fb62d491-b377-4c24-92ac-98e02e305bce"
}
```

After creation, the UI polls:

```http
GET /api/jobs/fb62d491-b377-4c24-92ac-98e02e305bce
```

Observed polling:

```text
Poll responses: 71
Statuses: pending, then done
First poll response: 2026-05-27T14:07:33.803Z
Done poll response:  2026-05-27T14:10:35.500Z
Submit-to-done time: ~185.6 seconds
```

Done response shape:

```json
{
  "id": "fb62d491-b377-4c24-92ac-98e02e305bce",
  "type": "video",
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "prompt": "[fixed Blowjob template prompt omitted]",
  "negative_prompt": "slow motion, morphing, distorted face, hands merging with skin, extra fingers, cartoonish, low resolution, disconnected body parts, blurry, jittery, static",
  "resolution": "720p",
  "duration": 4,
  "external_task_id": "509b0c20-f4f6-48f0-9803-d08bd955a62b",
  "output_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/509b0c20-f4f6-48f0-9803-d08bd955a62b/result_00.mp4",
  "status": "done",
  "coin_cost": 0,
  "error": null
}
```

Note: the successful terminal response preserved `resolution: "720p"` in the focused capture. If a separate history endpoint shows older video jobs with `1080p`/`15`, treat those as unrelated previous jobs, not this capture.

## Blowjob Video With Nudify First

Capture files:

```text
output/har/blowjob-nudify-first.har
output/har/blowjob-nudify-first-api-capture.json
output/har/blowjob-nudify-first-api-summary.json
```

UI path:

1. Open the home/create screen at `https://app.generateporn.ai/`.
2. Select the `Blowjob` video template card.
3. Select the `URL` source tab.
4. Use the same source URL as the earlier successful Blowjob URL capture:

```text
https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png
```

5. Click `Nudify First (free with PRO)`.
6. Click `GENERATE VIDEO FREE`.

As expected, enabling `Nudify First` creates two complete request/polling cycles.

Step 1 creates an edit job:

```http
POST /api/jobs/edit
```

Observed request body:

```json
{
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "prompt": "Remove all clothing, fully nude, keep face and pose unchanged"
}
```

Observed response:

```json
{
  "job_id": "3938244f-f143-45b8-b1b2-9da966428265"
}
```

The app then polls:

```http
GET /api/jobs/3938244f-f143-45b8-b1b2-9da966428265
```

Observed edit polling statuses:

```text
pending x7, done x1
```

Observed edit timing:

```text
Create response: 2026-05-27T15:39:33.655Z
Done response:   2026-05-27T15:39:55.164Z
Create-to-done:  ~21.5 seconds
```

Terminal edit response included:

```json
{
  "type": "edit",
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "external_task_id": "19ea9ac7-ec20-482e-8d19-2d3c726180a7",
  "output_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/19ea9ac7-ec20-482e-8d19-2d3c726180a7/result_00.png",
  "status": "done",
  "coin_cost": 0,
  "error": null
}
```

Step 2 creates the video job using the edit job's `output_url` as the new `input_url`:

```http
POST /api/jobs/video
```

Observed request body shape:

```json
{
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/19ea9ac7-ec20-482e-8d19-2d3c726180a7/result_00.png",
  "prompt": "[fixed Blowjob template prompt omitted]",
  "negative_prompt": "slow motion, morphing, distorted face, hands merging with skin, extra fingers, cartoonish, low resolution, disconnected body parts, blurry, jittery, static",
  "resolution": "720p",
  "duration": 4
}
```

Observed response:

```json
{
  "job_id": "9dc72049-fde7-4d4d-981a-c2967d97ab67"
}
```

The app then polls:

```http
GET /api/jobs/9dc72049-fde7-4d4d-981a-c2967d97ab67
```

Observed video polling statuses:

```text
pending x60, done x1
```

Observed video timing:

```text
Create response: 2026-05-27T15:39:56.572Z
Done response:   2026-05-27T15:42:36.063Z
Create-to-done:  ~159.5 seconds
```

Terminal video response included:

```json
{
  "type": "video",
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/19ea9ac7-ec20-482e-8d19-2d3c726180a7/result_00.png",
  "resolution": "720p",
  "duration": 4,
  "external_task_id": "88292930-b664-4c48-a214-cbf78bffe62d",
  "output_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/88292930-b664-4c48-a214-cbf78bffe62d/result_00.mp4",
  "status": "done",
  "coin_cost": 0,
  "error": null
}
```

Important behavior: `Nudify First` is an inline pre-processing edit job. It does not change the final video endpoint; it simply waits for `/api/jobs/edit` to finish, then passes that edit `output_url` into `/api/jobs/video`.

## Custom Image Flow

UI path:

1. Open Custom Mode at `https://app.generateporn.ai/editor`.
2. The editor defaults to `Edit Image`.
3. Choose source mode `URL`.
4. Fill the visible `input[type=url]` and click `Use`.
5. Fill the prompt textarea.
6. Submit with `EDIT IMAGE FREE`.

Observed source URL:

```text
https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png
```

Observed request:

```http
POST /api/jobs/edit
Content-Type: application/json
Origin: https://app.generateporn.ai
Referer: https://app.generateporn.ai/
```

Observed request body:

```json
{
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "prompt": "lip filler"
}
```

Historical note: this 2026-05-27 URL capture included `seed: null`. The 2026-06-01 fresh edit upload capture omitted `seed`, and the local app now omits `seed` for both upload and URL edit jobs.

Observed response:

```json
{
  "job_id": "5732fea9-5d86-4dec-abf1-c4b5cd5ed8e7"
}
```

Polling:

```text
GET /api/jobs/5732fea9-5d86-4dec-abf1-c4b5cd5ed8e7
Poll responses: 17
Statuses: pending, then done
First poll response: 2026-05-27T14:41:52.644Z
Done poll response:  2026-05-27T14:42:24.920Z
Submit-to-done time: ~34.5 seconds
```

Done response changes:

```json
{
  "type": "edit",
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "prompt": "lip filler",
  "external_task_id": "06317556-2197-4418-964c-67ba10b438e5",
  "output_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/06317556-2197-4418-964c-67ba10b438e5/result_00.png",
  "status": "done",
  "coin_cost": 0,
  "error": null
}
```

## Custom Video Flow

Custom Video can be opened either by selecting the `Video` tab in Custom Mode or, after a custom image completes, by clicking `Animate this with Wan 2.7 Video`. The video screen has the same `Upload`/`URL` source controls plus prompt textarea and video quality buttons.

Observed source URL:

```text
https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png
```

Observed video quality controls:

```text
720p · 4s   120 coins
720p · 8s   200 coins
1080p · 10s 400 coins
1080p · 15s 600 coins
```

The submitted capture selected `1080p · 10s 400 coins`, which mapped directly to:

```json
{
  "resolution": "1080p",
  "duration": 10
}
```

Inferred control mapping:

```text
720p · 4s   -> resolution: "720p",  duration: 4
720p · 8s   -> resolution: "720p",  duration: 8
1080p · 10s -> resolution: "1080p", duration: 10
1080p · 15s -> resolution: "1080p", duration: 15
```

Observed request:

```http
POST /api/jobs/video
Content-Type: application/json
Origin: https://app.generateporn.ai
Referer: https://app.generateporn.ai/
```

Observed request body:

```json
{
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "prompt": "The woman dances playfully in a warmly lit room.",
  "resolution": "1080p",
  "duration": 10,
  "seed": null
}
```

Observed response:

```json
{
  "job_id": "cfc180c2-15bf-4092-a1d0-7d7561a4837b"
}
```

Polling:

```text
GET /api/jobs/cfc180c2-15bf-4092-a1d0-7d7561a4837b
Poll responses: 92
Statuses: pending, then done
First poll response: 2026-05-27T14:45:23.490Z
Done poll response:  2026-05-27T14:48:25.997Z
Submit-to-done time: ~185.0 seconds
```

Done response changes:

```json
{
  "type": "video",
  "input_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/0307c40e-514f-43c0-b75c-bbe824600dd6/result_00.png",
  "prompt": "The woman dances playfully in a warmly lit room.",
  "resolution": "1080p",
  "duration": 10,
  "external_task_id": "5d897524-0767-4e74-bbd3-51ead041a25f",
  "output_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/5d897524-0767-4e74-bbd3-51ead041a25f/result_00.mp4",
  "status": "done",
  "coin_cost": 0,
  "error": null
}
```

## Job Polling

After creation, the app polls:

```http
GET /api/jobs/{job_id}
```

Observed polling cadence was about every 2 seconds. The edit job took roughly 18 seconds from create request start to the first `done` response in this capture.

Pending response shape:

```json
{
  "id": "dd0a33dd-3bd0-41c0-9373-8b615cc7d4bc",
  "type": "edit",
  "input_url": null,
  "prompt": "lip filler",
  "negative_prompt": null,
  "resolution": null,
  "duration": null,
  "seed": null,
  "external_task_id": "d1724808-4e4f-4432-92e5-d919f4469dd3",
  "output_url": null,
  "status": "pending",
  "coin_cost": 0,
  "error": null,
  "created_at": 1779887581,
  "shared": false,
  "shared_at": null,
  "priority": "normal",
  "favorited": false,
  "favorited_at": null
}
```

Done response changes:

```json
{
  "status": "done",
  "output_url": "https://mule-router-assets.muleusercontent.com/router_public/production/ephemeral/d1724808-4e4f-4432-92e5-d919f4469dd3/result_00.png"
}
```

The output URL is on `mule-router-assets.muleusercontent.com` and appears to use the `external_task_id` as the asset directory.

## Account Refresh

The app calls `/api/me` after job creation and again after completion:

```http
GET /api/me
```

This returns coin balance and subscription information. The captured account had a `max` subscription, and the edit job returned `coin_cost: 0`.

In the Nudify capture, the app also called `/api/me` after creation and after completion. A Clerk session token refresh request was also observed during the polling window:

```http
POST https://clerk.generateporn.ai/v1/client/sessions/{session_id}/tokens
```

## Auth Notes

The current app bundle builds API requests with a Clerk bearer token:

```http
Authorization: Bearer <Clerk token>
```

The exported HAR does not show `Authorization` or `Cookie` headers for the API calls, likely because the HAR was exported with sensitive headers omitted or sanitized. Treat the raw HAR as sensitive anyway: it contains a full source image payload, account metadata, and Clerk session-touch requests.

## File Upload Debugging

The frontend uses a shared source picker for uploads and URL sources. Local uploads are read in-browser with `FileReader.readAsDataURL(file)`, previewed directly, and passed upward with an `isBase64: true` flag. URL mode passes the typed URL upward with `isBase64: false`.

Observed source picker behavior from the current bundle:

```js
const reader = new FileReader();
reader.onload = event => {
  const value = event.target?.result;
  setPreview(value);
  onImage(value, true);
};
reader.readAsDataURL(file);
```

The upload field accepts:

```html
image/jpeg,image/png,image/webp,image/bmp
```

The API field chosen for that source depends on the flow:

```text
Nudify / image edit upload:
  POST /api/jobs/edit
  { "image_base64": "data:image/...", "prompt": "..." }

Image edit URL:
  POST /api/jobs/edit
  { "input_url": "https://...", "prompt": "..." }

Custom video upload, according to the current frontend bundle:
  POST /api/jobs/video
  { "image_base64": "data:image/...", "prompt": "...", "resolution": "...", "duration": ..., "seed": null }

Custom video URL:
  POST /api/jobs/video
  { "input_url": "https://...", "prompt": "...", "resolution": "...", "duration": ..., "seed": null }

Home-page video templates, including Blowjob and Doggystyle:
  POST /api/jobs/video
  { "input_url": sourceValue, "prompt": "...", "negative_prompt": "...", "resolution": "...", "duration": ... }
```

The earlier failed Blowjob upload captures stored the uploaded file as a data URL, but then sent it to `/api/jobs/video` under `input_url` instead of `image_base64`. Both captured template upload attempts returned:

```json
{
  "error": "submission_failed"
}
```

When the same template used the URL source tab, the request body used a normal hosted URL in `input_url` and succeeded. Later implementation notes should treat template videos as supporting both upload and URL sources, using `image_base64` for uploaded data URLs and `input_url` for hosted URLs.

## Implementation Implications

- For a mobile UI, the minimum edit flow is: collect source image or URL, collect prompt, `POST /api/jobs/edit`, then poll `GET /api/jobs/{job_id}` until `status` is `done` or `failed`.
- Nudify appears to be a preset over the same edit flow: it posts to `POST /api/jobs/edit` with the fixed prompt shown above and then polls the normal job URL.
- The Blowjob video template posts to `POST /api/jobs/video`, not `/api/jobs/edit`.
- The Blowjob template's `Nudify First` option runs `POST /api/jobs/edit` first, polls that edit job to `done`, then submits `POST /api/jobs/video` with the edit `output_url` as `input_url`.
- For the failed home-page video template upload captures, the source image was sent as `input_url` even when the value was a base64 data URL. Do not copy that request shape; use `image_base64` for uploaded template sources.
- For Custom Video uploads, the current frontend bundle indicates the source image should be sent as `image_base64`, not `input_url`.
- If video submission returns `500 {"error":"submission_failed"}`, the UI shows generation failure and does not poll because there is no job id.
- For the Blowjob video template, URL source mode succeeded with an existing hosted image URL. Template videos should support both URL and upload in our app, with field selection based on source kind.
- Successful video jobs poll the same `GET /api/jobs/{job_id}` endpoint and return an MP4 `output_url` under the `external_task_id` directory.
- Custom Image is the same `POST /api/jobs/edit` flow. Send `prompt` plus exactly one source field: `image_base64` for uploads or `input_url` for hosted URLs. Do not send `seed` for edit jobs.
- Custom Video is the same `POST /api/jobs/video` flow. The captured URL-mode request used `input_url`, `prompt`, `resolution`, `duration`, and `seed: null`; the bundle indicates upload mode swaps `input_url` for `image_base64`.
- The Custom Video quality labels map directly to the API `resolution` and `duration` fields.
- Source input supports `image_base64` for edit uploads, custom video uploads per bundle inspection, and `input_url` for URL mode.
- Template prompts can be recovered from history/list responses. `GET /api/jobs?type=all&page=N` returns list items with original `prompt` and `negative_prompt`; use a known template job ID, for example `fb62d491-b377-4c24-92ac-98e02e305bce` for Blowjob, to seed a local template registry.
- Poll every ~2 seconds to match the production UI.
- On success, use `output_url` directly as the generated asset URL.
- On failure, read `status` and `error`; current capture did not include a failed edit response.
- Refresh account state with `/api/me` after job submission/completion if the UI needs current coins/subscription.

## Future Capture Workflow

HAR captures in this workspace were recorded with Playwright Chromium using:

```text
output/har/har-recorder.mjs
```

The script launches a persistent Chromium profile at:

```text
output/har/profile
```

That profile preserves the app login between runs. Each run should use a unique basename so older HARs are not overwritten:

```sh
HAR_RECORDER_BASENAME=custom-flows \
HAR_RECORDER_URL=https://app.generateporn.ai/ \
node output/har/har-recorder.mjs
```

Run it from a separate Terminal window, not a short-lived shell command, so the recorder process stays alive while the browser is used. The script writes a ready file:

```text
output/har/{basename}.ready.json
```

That file contains the Chrome DevTools Protocol URL, usually:

```text
http://127.0.0.1:9223
```

Connect automation to the live browser with Playwright:

```js
import { chromium } from "@playwright/test";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
const context = browser.contexts()[0];
const page = context.pages()[0] ?? await context.newPage();
```

To stop and flush the HAR, create the stop file shown in the ready JSON:

```sh
touch output/har/stop-{basename}
```

After the recorder exits, expected outputs are:

```text
output/har/{basename}.har
output/har/{basename}-storage.json
```

Treat both as sensitive. HARs can include source image payloads, Clerk session requests, account metadata, bearer tokens, and generated media URLs.

Recommended capture pattern:

1. Start a fresh HAR run with a unique basename.
2. Use the persistent browser profile to open `https://app.generateporn.ai/`.
3. Navigate and submit the flow manually or through Playwright.
4. Attach a focused request/response logger during submit and polling.
5. Stop the recorder only after the job is `done`, `failed`, or the UI gives an immediate submit failure.
6. Save a sanitized summary JSON alongside the raw HAR.
7. Record the endpoint, request body shape, create response, polling URL, terminal job shape, timing, and output URL pattern in this file.

Useful navigation:

```text
Home/create page: https://app.generateporn.ai/
Custom Mode (I2V + model picker): https://app.generateporn.ai/editor
New Text-to-Video (T2V, no image): https://app.generateporn.ai/generate   (new route as of 2026-05-30)
Studio/history:  https://app.generateporn.ai/history
```

Home page template cards observed:

```text
Blowjob
Doggystyle
Nudify
Edit Image
CUSTOM MODE
```

Custom Mode notes:

- `/editor` defaults to `Edit Image`.
- The `Video` tab exposes Wan image-to-video controls.
- After a custom image completes, `Animate this with Wan 2.7 Video` opens Custom Video with the generated image already loaded as URL source.
- Source controls are `Upload` and `URL`; URL mode has `input[type=url]` with placeholder `https://example.com/image.jpg` and a `Use` button.
- Prefer URL mode when possible. For video, URL mode succeeded while file/base64 upload returned `submission_failed`.

Flow entry points:

```text
Nudify: home page -> Nudify card -> upload or URL source -> NUDIFY FREE
Blowjob: home page -> Blowjob card -> upload or URL source -> optional Nudify First -> GENERATE VIDEO FREE
Custom Image: /editor -> Edit Image -> source -> prompt -> EDIT IMAGE FREE
Custom Video: /editor -> Video -> source -> quality button -> prompt -> GENERATE FREE
```

When capturing API details, redact or omit:

```text
Authorization headers
Cookie and Set-Cookie headers
Clerk token/session responses
JWTs
User ids and email addresses
Large base64 image payloads
Explicit prompt text if it is not needed for the API shape
```

The focused summaries in `output/har/*-api-summary.json` are intended for future reference. The raw HAR files are only for deeper debugging.

## New Video Models (Captured 2026-05-30, new-video-models.har)

This 7.5 MB HAR captures multiple generations using **newly introduced video models** on the GeneratePorn.ai platform. It includes 5 distinct `/api/jobs/video` submissions (4 image-to-video with different models + 1 pure text-to-video), extensive polling, analytics beacons that explicitly log UI choices, and related Clerk/me traffic. No large JS bundles were present in this particular capture (focused on API + analytics after UI load).

### Observed Models and Create Payload Shapes

All video creation continues to target `POST https://api.generateporn.ai/api/jobs/video`.

**Image-to-Video (I2V) models** (require source image):

- `wan2.7-i2v` (high-quality Wan variant)
  - Example payload (with image):
    ```json
    {
      "image_base64": "data:image/png;base64,[~1.6MB redacted]",
      "modelId": "wan2.7-i2v",
      "prompt": "...",
      "resolution": "1080p",
      "duration": 15,
      "seed": null
    }
    ```
  - Used with preset `video_1080_15s`

- `wan2.7-i2v-spicy` (Spicy mode)
  - Same request shape and option matrix as `wan2.7-i2v`.
  - Captured in `spicy-mode.har` with upload source, `resolution: "1080p"`, `duration: 15`, and `seed: null`.

- `wan2.6-i2v-flash` (faster/optimized variant of the 2.7 family)
  - Same shape as above.
  - Used with `video_1080_15s`

- `wan2.2-i2v-plus`
  - Used with `video_1080_10s` (lower max duration in observed sample)

- `happyhorse-1.0-i2v` (specialized / fun model)
  - Used with `video_720_8s` only (lowest tier observed; likely restricted quality/duration options)

**Text-to-Video (T2V) — new pure text mode**:

- `wan2.7-t2v`
  - **Critical difference**: No `image_base64` (and no `input_url`). Pure text-to-video.
  - Example:
    ```json
    {
      "modelId": "wan2.7-t2v",
      "prompt": "A petite 18yo woman ...",
      "resolution": "1080p",
      "duration": 15,
      "seed": null
    }
    ```
  - Accessed via new route `/generate` (in addition to the existing `/editor` Video tab).
  - Analytics confirmed: `{"preset":"video_1080_15s","model":"wan2.7-t2v"}`
  - Job response `type` remains `"video"`. No `input_url` field populated.

### Job Response Shape (now includes model_id)

Polling `GET /api/jobs/{job_id}` returns the model used:

```json
{
  "id": "...",
  "type": "video",
  "model_id": "wan2.7-i2v",   // or wan2.7-i2v-spicy, wan2.6-i2v-flash, wan2.2-i2v-plus, happyhorse-1.0-i2v, wan2.7-t2v
  "prompt": "...",
  "resolution": "1080p",
  "duration": 15,
  "seed": null,
  "status": "pending",
  ...
}
```

Note camelCase `modelId` on create → snake_case `model_id` on read (consistent with other fields).

### UI Presets & Model Limitations (Inferred from Analytics + Actual Submissions)

Plausible `generate_video` events log exactly what the frontend sent:

- `video_1080_15s` + wan2.7-i2v / wan2.6-i2v-flash / wan2.7-t2v
- `video_1080_10s` + wan2.2-i2v-plus
- `video_720_8s` + happyhorse-1.0-i2v

**Conclusion**: Not all models support the full matrix of resolutions (720p/1080p) × durations (4s/8s/10s/15s) that the old unified "Custom Video" offered. The frontend (in `/editor` and the new `/generate` experience) now dynamically offers only compatible "preset" / quality buttons per selected model. Some models are tiered (flash, plus, specialized).

### New Navigation / UX Surface

- Existing Custom Video flow lives at `/editor` (Video tab) — now shows model selector.
- New dedicated **Text-to-Video** entry point at `/generate` (pageview observed immediately before the pure `wan2.7-t2v` submission). This flow has no source image picker.

### Implications for Local App (genai)

1. **Creation modes / model registry** (`src/server/create-*.ts`, `getCreateModeDefinitions`, `CREATE_VIDEO_QUALITY_OPTIONS`) must evolve:
   - Add `modelId` as a first-class selectable field (or per-mode default).
   - Support a new "Text to Video" mode that sets `source.required = false` and omits image handling entirely (pure prompt + modelId + resolution + duration).
   - Per-model quality/duration option lists (instead of one global `CREATE_VIDEO_QUALITY_OPTIONS`).

2. Request shaping in `buildCreateApiRequest` (create-api.ts) needs to always include the chosen `modelId` for video jobs.

3. The local UI (CreateStudio, SourceTabs, etc.) should:
   - Offer model picker when mode is video-related.
   - Hide/disable source picker entirely for T2V modes.
   - Dynamically populate quality selects based on chosen model (to avoid submitting unsupported combos that the upstream may reject).

4. Job polling / history (`PublicCreateJob`, catalog items) should surface `modelId` / `model_id` for display and filtering ("which model made this?").

5. Templates (`create-templates.ts`) can now capture `modelId` + the specific preset used.

6. Analytics in the upstream now distinguish models clearly — useful for future cost/quality comparisons once we have completed jobs.

### Captured Job IDs (for reference / future polling)

- wan2.7-i2v: fc14c658-c41f-4a00-8599-b195aba4a7b2
- wan2.6-i2v-flash: 47aaba25-239a-4ae4-966e-eb1217ae651b
- wan2.2-i2v-plus: c5add808-94b4-4c09-838a-dad49099ff05
- happyhorse-1.0-i2v: fcbe0d44-7ecd-4cb0-99a9-9dfc69ef5dc3
- wan2.7-t2v: 811e720a-4c6f-4f8f-8910-b212d6e7fb80

All were still `pending` at the end of the capture window (expected — high-quality video inference takes 2–4+ minutes).

### Recommended Next Capture

- Load the model picker in `/editor` and `/generate` (with HAR recorder running) to capture the exact client-side config that drives available models + per-model preset lists.
- Successfully run one job per model to completion and capture the final `done` response shape + `output_url`.
- Test edge cases (e.g. unsupported duration for happyhorse or wan2.2) to see validation errors.

This capture proves the backend has moved to an explicit multi-model video system while keeping a single `/jobs/video` endpoint (the model does the heavy lifting).

### Authoritative Model Configurations (extracted from JS bundle)

The frontend maintains two parallel model registries in the bundle.

#### Video Models

The user located the following model definition array directly in the production bundle (`assets/index-Der5BJjj.js`):

```js
[
  {
    id: `wan2.7-i2v`,
    label: `Wan 2.7`,
    dashscopeModelId: `wan2.7-i2v`,
    host: `maas`,
    protocol: `media`,
    kind: `i2v`,
    resolutions: [`720P`, `1080P`],
    durations: [4, 8, 10, 15],
    tier: `pro`,
    description: `Newest Wan — most cinematic motion and detail.`
  },
  {
    id: `wan2.7-i2v-spicy`,
    label: `Spicy`,
    dashscopeModelId: `wan2.7-i2v-spicy`,
    host: `maas`,
    protocol: `media`,
    kind: `i2v`,
    resolutions: [`720P`, `1080P`],
    durations: [4, 8, 10, 15],
    tier: `pro`,
    description: `Wan 2.7 image-to-video tuned for explicit high-intensity motion.`
  },
  {
    id: `wan2.6-i2v-flash`,
    label: `Wan 2.6 Flash`,
    dashscopeModelId: `wan2.6-i2v-flash`,
    host: `intl`,
    protocol: `img_url`,
    kind: `i2v`,
    audio: true,
    resolutions: [`720P`, `1080P`],
    durations: [4, 8, 10, 15],
    tier: `standard`,
    description: `Fast Wan with native audio.`
  },
  {
    id: `wan2.2-i2v-plus`,
    label: `Wan 2.2 Plus`,
    dashscopeModelId: `wan2.2-i2v-plus`,
    host: `maas`,
    protocol: `img_url`,
    kind: `i2v`,
    fixedDuration: true,
    resolutions: [`1080P`],
    durations: [5],
    tier: `standard`,
    description: `Reliable Wan 2.2 image-to-video (1080p, fixed ~5s clips).`
  },
  {
    id: `wan2.7-t2v`,
    label: `Wan 2.7 Text→Video`,
    dashscopeModelId: `wan2.7-t2v`,
    host: `maas`,
    protocol: `t2v`,
    kind: `t2v`,
    defaultRatio: `16:9`,
    resolutions: [`720P`, `1080P`],
    durations: [4, 8, 10, 15],
    tier: `pro`,
    description: `Generate video from a prompt — no image needed.`
  }
]
```

This is the **single source of truth** the frontend uses to drive the model picker and quality/duration segmented controls on both `/editor` and `/generate`.

**Clean reference file saved:** `research/video-models-config.json`

#### Updated Supported Combinations (now authoritative)

| Model                  | Resolutions     | Durations          | Special Flags                  | Tier     | Notes |
|------------------------|-----------------|--------------------|--------------------------------|----------|-------|
| `wan2.7-i2v`           | 720P, 1080P     | 4, 8, 10, 15       | —                              | pro      | Best quality I2V |
| `wan2.7-i2v-spicy`     | 720P, 1080P     | 4, 8, 10, 15       | —                              | pro      | Spicy mode I2V |
| `wan2.6-i2v-flash`     | 720P, 1080P     | 4, 8, 10, 15       | `audio: true`                  | standard | Fast + native audio |
| `wan2.2-i2v-plus`      | **1080P only**  | **5 only**         | `fixedDuration: true`          | standard | Fixed short clips |
| `wan2.7-t2v`           | 720P, 1080P     | 4, 8, 10, 15       | `protocol: "t2v"`, `defaultRatio: "16:9"` | pro | **Pure text-to-video** — no image source required |

#### Additional Fields & Their Meaning

- `protocol`:
  - `media` → likely sends image as base64 or media reference
  - `img_url` → expects a hosted image URL
  - `t2v` → pure text-to-video (no image at all)
- `host`: `maas` vs `intl` — probably different backend routing / regional endpoints.
- `tier`: Likely maps to subscription level (`pro` requires higher plan?).
- `dashscopeModelId`: The actual identifier sent to the underlying DashScope / Alibaba Cloud service.

This data should now drive the local app's creation modes (see implications below).

### Additional findings from initial-page-load HAR (new-video-models-generate-initial-page-load.har)

This HAR was captured to surface the client-side source of truth (JS bundle on /editor and the new /generate page) for the complete matrix of supported (model × resolution × duration) combinations. Unfortunately the export contained only 14 small entries (mostly auth + recent jobs + analytics). No HTML document, no script bundles, and no dedicated `/api/.../video/models` or options endpoint response was present.

### Findings from full unfiltered recapture (new-video-models-generate-initial-page-load-2.har)

This 14 MB capture (filtering completely disabled) was the one intended to finally reveal the client-side source of truth.

**Successfully captured:**
- Minimal HTML shell for `https://app.generateporn.ai/generate` (1.3 kB).
- Primary application bundle: `https://app.generateporn.ai/assets/index-Der5BJjj.js` (~711 kB decompressed). This is the same bundle used by both /editor and /generate.
- Supporting CSS and various video result partial responses (206) hosted on `generations.generateporn.ai`.

**Key negative findings after deep bundle analysis (the bundle/config was not declarative):**
- No dedicated model/options API response was present (no `/api/video/models`, `/api/options`, etc.).
- The main bundle (`index-Der5BJjj.js`) was extracted in full (~711 kB) and subjected to multiple rounds of targeted regex and context searches looking for:
  - The known model IDs ("wan2.7-t2v", etc.)
  - Arrays or objects containing durations (4/8/10/15), resolutions ("1080p"/"720p"), or presets
  - Code fragments containing "video" + "model", "modelId", "generateVideo", etc.
  - Proximity of video-related terms with option structures
- **Result**: Almost no usable static configuration was found in the bundle via automated searches. The model ID strings do not appear as plain literals in easily greppable contexts.

However, the user later manually located the authoritative model definition array inside the bundle. It has been extracted and saved cleanly below.

Only one significant application JS file was loaded in the entire capture: the main `index-Der5BJjj.js` bundle. No other application code-split chunks related to video UI were fetched during initial page load.

**Current best source of truth for supported combos therefore remains behavioral evidence** from the two previous focused captures (successful POST bodies + Plausible events logging exact `(preset, model)` pairs the UI actually submitted, plus live history from `/api/jobs`).

**Practical implication for the local app:**
We should implement model selection + dynamic quality/duration options based on the observed successful combinations documented earlier in this section, and treat the matrix as something that may need periodic refresh via future captures or live probing. The absence of a clean static config in the production bundle means we cannot simply "parse the frontend" for the definitive allow-list.

#### Concrete Workflow Example (Nudify First → Video)

The following real client code (from the bundle) shows exactly how the "Nudify First" option is implemented for video generation:

```js
_.useCallback)(async () => {
    if (!o) return;
    m.current = !1;
    let e = o.value, n = o.isBase64;

    try {
        if (c) {  // c = "Nudify First" flag
            d(`nudifying`);
            let {job_id: i} = await t(`/api/jobs/edit`, {
                method: `POST`,
                body: JSON.stringify({
                    [n ? `image_base64` : `input_url`]: e,
                    prompt: Tf   // fixed nudify prompt
                })
            });
            if (e = await b(i),   // b = poller that returns completed job
                n = !1,
                m.current) return;
            r()
        }

        d(`generating`);
        let {job_id: i} = await t(`/api/jobs/video`, {
            method: `POST`,
            body: JSON.stringify({
                modelId: bf,           // selected video model
                input_url: e,          // always input_url here (result of previous job or original)
                prompt: Ef,
                negative_prompt: Df,
                resolution: `720p`,
                duration: 4
            })
        }),
        a = await b(i);  // wait for video job

        if (m.current) return;
        p(a), d(`done`), r()
    } catch (e) { ... }
}, ...)
```

**Key behaviors this reveals:**

- Nudify is implemented as a regular `/api/jobs/edit` call with a fixed prompt (`Tf`).
- The result of the edit job (`await b(i)`) is then passed as `input_url` to the video job.
- For the video step in a workflow, the client **always** uses `input_url` (never `image_base64`), even if the original source was an upload.
- The poller helper `b(jobId)` is used for both steps and returns the completed job object (containing `output_url`).
- Hardcoded low-res example here (720p/4s), but in real UI this would come from the selected model's allowed durations.

This is the exact behavior our local "nudify-video" workflow mode should replicate (and largely already attempts to).

See the "High-Value Pieces Still Missing" section below for what to extract next around the `b` poller and the request builder.

### High-Value Pieces Still Missing

Even with the excellent model registry data, several critical implementation details are still opaque:

1. **Request Body Construction Logic** (highest priority)
   - How exactly does `protocol` (`media` / `img_url` / `t2v`) translate into the final fields sent?
     - When is `image_base64` used vs `input_url`?
     - For T2V (`protocol: "t2v"`), is the body completely empty of image fields?
   - Are there any other fields conditionally added based on the model (e.g. `audio: true` for wan2.6-flash)?

2. **Image Model Differences**
   - Exact payload differences between `sync` and `async` image models.
   - How `thinkingMode` and `promptExtend` actually modify the request (are they top-level booleans?).
   - The precise pixel size strings that must be sent (the bundle shows the mapping, but does the client always send the mapped value?).

3. **Polling & Job Lifecycle**
   - Do async image jobs (WAN image models) behave exactly like video jobs for polling?
   - Any differences in final response shape between sync and async image results?

4. **Tier / Gating**
   - Is tier enforcement done purely client-side (hiding models), or does the backend also reject requests?

5. **The Actual Builder Functions**
   - The functions in the bundle that take a chosen model object + user inputs and produce the final `body` sent to DashScope. Seeing even one of these would be extremely high value.

These are the remaining high-leverage pieces that would allow near-perfect parity in the local creation system.

#### Image Generation Models (also from the same bundle)

Immediately after the video models, the bundle also contains this image model registry (used by the "Edit Image", "Text to Image", and related flows):

```js
[
  {
    id: `qwen-image-2.0-pro`,
    label: `Qwen Image 2.0 Pro`,
    provider: `dashscope`,
    dashscopeModelId: `qwen-image-2.0-pro`,
    endpoint: `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`,
    transport: `sync`,
    coinsPerImage: 20,
    sizes: { "1:1": `2048*2048`, "4:3": `2368*1728`, "3:4": `1728*2368` },
    defaultSize: `3:4`,
    supports: { negativePrompt: true, promptExtend: true, thinkingMode: false },
    tier: `pro`,
    description: `Highest quality. Strong text rendering, posters, illustrations.`
  },
  {
    id: `qwen-image-2.0`,
    label: `Qwen Image 2.0`,
    provider: `dashscope`,
    dashscopeModelId: `qwen-image-2.0`,
    endpoint: `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`,
    transport: `sync`,
    coinsPerImage: 12,
    sizes: { "1:1": `2048*2048`, "4:3": `2368*1728`, "3:4": `1728*2368` },
    defaultSize: `3:4`,
    supports: { negativePrompt: true, promptExtend: true, thinkingMode: false },
    tier: `standard`,
    description: `Balanced quality and cost. Same family as Pro.`
  },
  {
    id: `wan2.7-image-pro`,
    label: `WAN 2.7 Image Pro`,
    provider: `dashscope`,
    dashscopeModelId: `wan2.7-image-pro`,
    endpoint: `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image-generation/generation`,
    transport: `async`,
    coinsPerImage: 18,
    sizes: { "1:1": `2048*2048`, "4:3": `2368*1728`, "3:4": `1728*2368` },
    defaultSize: `3:4`,
    supports: { negativePrompt: false, promptExtend: false, thinkingMode: true },
    tier: `pro`,
    description: `WAN family — feature-rich, strong portraits and colors.`
  },
  {
    id: `wan2.7-image`,
    label: `WAN 2.7 Image`,
    provider: `dashscope`,
    dashscopeModelId: `wan2.7-image`,
    endpoint: `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/image-generation/generation`,
    transport: `async`,
    coinsPerImage: 10,
    sizes: { "1:1": `2048*2048`, "4:3": `2368*1728`, "3:4": `1728*2368` },
    defaultSize: `3:4`,
    supports: { negativePrompt: false, promptExtend: false, thinkingMode: true },
    tier: `standard`,
    description: `WAN family base model — good value.`
  },
  {
    id: `z-image-turbo`,
    label: `Z-Image Turbo`,
    provider: `dashscope`,
    dashscopeModelId: `z-image-turbo`,
    endpoint: `https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`,
    transport: `sync`,
    coinsPerImage: 5,
    sizes: { "1:1": `2048*2048`, "4:3": `2368*1728`, "3:4": `1728*2368` },
    defaultSize: `3:4`,
    supports: { negativePrompt: false, promptExtend: false, thinkingMode: false },
    tier: `turbo`,
    description: `Fastest and cheapest. Realistic portraits and product shots.`
  }
]
```

**Clean reference file saved:** `research/image-models-config.json`

#### Important Observations

- **Transport matters**: Some image models are `sync` (immediate result), others are `async` (require polling, similar to video).
- **Different endpoints**:
  - `multimodal-generation/generation` (used by Qwen and Z-Image Turbo)
  - `image-generation/generation` (used by WAN image models)
- **Feature flags** (`supports`):
  - Only some models support `negativePrompt`, `promptExtend`, or `thinkingMode`.
- **Aspect ratio handling**: The app uses friendly ratios (`3:4`, `4:3`, `1:1`) but maps them to specific pixel dimensions when calling the API.
- **Wan family overlap**: There are now both video (`wan2.7-i2v`, `wan2.7-t2v`) and image (`wan2.7-image`, `wan2.7-image-pro`) models from the same family.

This data should be used to expand the local app's `text-to-image` and `custom-image` modes with proper model selection and per-model feature support.

**Value extracted anyway** (from the 18.9 kB `GET /api/jobs?type=all&page=1` response containing 20 recent jobs, 17 of which were video):

- 17 video jobs on the first page of history.
- Very heavy real-world usage of the new pure **T2V** model:
  - `wan2.7-t2v` at `1080p / 15s` with `input_url: null` (6+ examples on this page alone). Confirms T2V is live and popular.
- I2V model usage in the wild (note several show `input_url: null` in history even for I2V models — the history API appears to normalize this; the creation payloads in the sibling HAR still show the `image_base64` for I2V):
  - `wan2.7-i2v` @ 1080p/15s
  - `wan2.6-i2v-flash` @ 1080p/15s (multiple)
  - `wan2.2-i2v-plus` @ 1080p/10s
  - `happyhorse-1.0-i2v` @ 720p/8s **and** @ 1080p/15s (one each). This is important: happyhorse is **not** strictly limited to the lowest tier; it successfully ran at 1080p 15s in at least one case.
- Several jobs with `model_id: null` (shown as "unknown" above) all at 1080p/15s. These may be legacy jobs, jobs created via a different client path, or an older default before `modelId` became mandatory in the create payload.
- No negative examples of rejected combos in this slice, but the distribution above (plus the controlled submissions in the sibling HAR) gives the current best picture of what the production UI actually allows and what users are successfully running.

**Combined picture across both HARs (best current evidence of supported combos)**

From controlled submissions + analytics events + live history:
- `wan2.7-t2v` (T2V): 1080p/15s confirmed (multiple independent sources). No image input.
- `wan2.7-i2v`: 1080p/15s (strong evidence).
- `wan2.6-i2v-flash`: 1080p/15s (strong).
- `wan2.2-i2v-plus`: 1080p/10s (controlled + history).
- `happyhorse-1.0-i2v`: 720p/8s and 1080p/15s (history shows both succeeded).

The frontend clearly restricts the preset/quality buttons shown to the user based on the selected model (otherwise we would see more variety in the controlled `generate_video` events). The exact exhaustive list per model lives in the (not captured here) client JS on /editor and /generate.

**Recommendation**: We now have the authoritative client-side model definitions (thanks to the data you extracted). Future captures should focus on:
- How the frontend actually builds the request body based on `protocol` / `host` / `transport`.
- Any additional fields sent for specific models (e.g. `thinkingMode`, `audio`, `promptExtend`).
- The exact mapping when using URL sources vs base64 for the different `protocol` values.

See `research/gp-models-overview.md` for a quick summary of both video and image model families.
