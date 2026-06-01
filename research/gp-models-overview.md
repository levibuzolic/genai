# GeneratePorn.ai Models Overview (from client bundle)

This directory contains the authoritative model definitions reverse-engineered from the production JavaScript bundle.

## Files

- `video-models-config.json` — All video models (I2V + T2V)
- `image-models-config.json` — All image generation models
- `generateporn-api-notes.md` (in parent `research/`) — Full analysis and implications

## Video Models

| ID                    | Kind | Protocol | Resolutions     | Durations     | Tier     | Notes |
|-----------------------|------|----------|-----------------|---------------|----------|-------|
| wan2.7-i2v            | i2v  | media    | 720P, 1080P     | 4,8,10,15     | pro      | Best cinematic |
| wan2.7-i2v-spicy      | i2v  | media    | 720P, 1080P     | 4,8,10,15     | pro      | Spicy mode |
| wan2.6-i2v-flash      | i2v  | img_url  | 720P, 1080P     | 4,8,10,15     | standard | Fast + audio |
| wan2.2-i2v-plus       | i2v  | img_url  | 1080P only      | 5 (fixed)     | standard | Short clips only |
| wan2.7-t2v            | t2v  | t2v      | 720P, 1080P     | 4,8,10,15     | pro      | Pure text-to-video |

## Image Models

| ID                    | Transport | Coins | Key Features                     | Tier     |
|-----------------------|-----------|-------|----------------------------------|----------|
| qwen-image-2.0-pro    | sync      | 20    | negativePrompt, promptExtend     | pro      |
| qwen-image-2.0        | sync      | 12    | negativePrompt, promptExtend     | standard |
| wan2.7-image-pro      | async     | 18    | thinkingMode                     | pro      |
| wan2.7-image          | async     | 10    | thinkingMode                     | standard |
| z-image-turbo         | sync      | 5     | Fastest                          | turbo    |

All aspect ratios are normalized to friendly values (`3:4`, `4:3`, `1:1`) in the UI and mapped to specific pixel dimensions on the backend.

See the full JSON files and the main research document for request shaping implications (especially `protocol` for video and `transport` + `endpoint` for images).

## High-Priority Remaining Extractions from Bundle

1. The function(s) that build the final request body for video jobs (search for code near `image_base64`, `input_url`, and the model objects).
2. Equivalent builder for image generation requests.
3. Any code that sets `thinkingMode`, `promptExtend`, or handles the different `transport` modes.
4. Polling logic differences (if any) between sync and async image jobs.
