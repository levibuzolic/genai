# GeneratePorn.ai Models Overview

This directory contains model and engine definitions reverse-engineered from production JavaScript bundles.

## Current Live Surface (captured 2026-06-03T22:53Z)

The current authenticated production UI has been relaunched around branded engines rather than an exposed Wan/Qwen model picker.

| Flow | Route | Engine | Endpoint | Key options |
|------|-------|--------|----------|-------------|
| Text to image | `/create/generate` | StillHeat v1.0 Preview | `POST /api/jobs/text2image` | aspect `1:1`, `3:4`, `4:3`, `9:16`; optional realism; seed |
| Edit image | `/create/edit` | StillHeat-EDIT v1.0 Preview | `POST /api/jobs/edit` | upload/source URL, prompt, optional realism, source dimensions, seed |
| Image to video | `/create/video` | MotionHeat v1.0 Preview | `POST /api/jobs/video` | source image, `720p`/`1080p`, 4-16s duration, optional negative prompt, seed |

Reference:

- `live-engines-config.json` — Current engine registry and request shapes.
- `generateporn-api-notes.md` — Full API notes and capture history.
- Raw capture: `output/har/generateporn-live-2026-06-03T22-53-22Z.har`.
- Bundle extraction: `output/bundles/generateporn-live-2026-06-03T22-53-22Z-app-bundle.js`.
- Successful submission capture: `output/har/generateporn-submit-2026-06-03T23-42-57Z.har`.

Important: the current live bundle does **not** contain or send the old `wan2.7-*`, `qwen-image-*`, or `z-image-turbo` model IDs from the June 1 capture. Treat those as historical/legacy observations unless a future capture shows the model picker returning.

Save point: commit `af4fd21` (`[Gan 2.7] Final notes before switching to their models`) preserves the old Gan/Wan/Qwen implementation and research state before the local app switched fully to StillHeat/StillHeat-EDIT/MotionHeat.

Successful current-production submissions confirmed these terminal `model_id` values:

| Flow | Terminal `type` | Terminal `model_id` |
|------|-----------------|---------------------|
| Text to image | `text2image` | `stillheat` |
| Edit image | `edit` | `stillheat-edit` |
| Image to video | `video` | `motionheat` |

## Files

- `live-engines-config.json` — Current live branded engines and API request shapes.
- `video-models-config.json` — Historical June 1 explicit video models (I2V + T2V).
- `image-models-config.json` — Historical June 1 explicit image generation models.
- `generateporn-api-notes.md` (in parent `research/`) — Full analysis and implications

## Historical Video Models (June 1 capture)

| ID                    | Kind | Protocol | Resolutions     | Durations     | Tier     | Notes |
|-----------------------|------|----------|-----------------|---------------|----------|-------|
| wan2.7-i2v            | i2v  | media    | 720P, 1080P     | 4,8,10,15     | pro      | Best cinematic |
| wan2.7-i2v-spicy      | i2v  | media    | 720P, 1080P     | 4,8,10,15     | pro      | Spicy mode |
| wan2.6-i2v-flash      | i2v  | img_url  | 720P, 1080P     | 4,8,10,15     | standard | Fast + audio |
| wan2.2-i2v-plus       | i2v  | img_url  | 1080P only      | 5 (fixed)     | standard | Short clips only |
| wan2.7-t2v            | t2v  | t2v      | 720P, 1080P     | 4,8,10,15     | pro      | Pure text-to-video |

## Historical Image Models (June 1 capture)

| ID                    | Transport | Coins | Key Features                     | Tier     |
|-----------------------|-----------|-------|----------------------------------|----------|
| qwen-image-2.0-pro    | sync      | 20    | negativePrompt, promptExtend     | pro      |
| qwen-image-2.0        | sync      | 12    | negativePrompt, promptExtend     | standard |
| wan2.7-image-pro      | async     | 18    | thinkingMode                     | pro      |
| wan2.7-image          | async     | 10    | thinkingMode                     | standard |
| z-image-turbo         | sync      | 5     | Fastest                          | turbo    |

In the June 1 bundle, aspect ratios were normalized to friendly values (`3:4`, `4:3`, `1:1`) in the UI and mapped to specific pixel dimensions on the backend. The current live StillHeat flow instead exposes `1:1`, `3:4`, `4:3`, and `9:16` directly.

See the full JSON files and the main research document for request shaping implications (especially `protocol` for video and `transport` + `endpoint` for images).

## High-Priority Remaining Extractions

1. Check whether the old explicit model picker is hidden by plan, feature flag, route, or has been removed from production.
2. Preserve compatibility with historical jobs that still contain `model_id` values such as `wan2.7-i2v`.
3. Add local app create support for `/api/jobs/text2image`, seed, realism, and the current StillHeat/MotionHeat terminal `model_id` values.
