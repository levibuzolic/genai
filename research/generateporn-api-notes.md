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

Observed request body:

```json
{
  "image_base64": "data:image/png;base64,[omitted]",
  "prompt": "lip filler"
}
```

Observed response:

```json
{
  "job_id": "dd0a33dd-3bd0-41c0-9373-8b615cc7d4bc"
}
```

The current frontend bundle indicates the same endpoint can send either `image_base64` or `input_url`, depending on how the source image was provided:

```json
{
  "input_url": "https://...",
  "prompt": "..."
}
```

Important capture note: the original edit HAR used `image_base64`. The later Custom Image capture confirmed URL mode sends `input_url` directly.

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
  "prompt": "lip filler",
  "seed": null
}
```

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
- Custom Image is the same `POST /api/jobs/edit` flow, but URL mode sends `input_url` plus `prompt` and `seed: null`.
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
Custom Mode:     https://app.generateporn.ai/editor
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
