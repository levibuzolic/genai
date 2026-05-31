import sharp from "sharp"

const JPEG_QUALITY = 92
const CREATE_IMAGE_JPEG_QUALITY = 90
const CREATE_IMAGE_MAX_DIMENSION = 2400
const JPEG_BACKGROUND = { r: 255, g: 255, b: 255 }

export type CreateImageJpeg = {
  bytes: Buffer
  width: number
  height: number
}

export async function pngBufferToHighQualityJpeg(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { animated: false })
    .rotate()
    .flatten({ background: JPEG_BACKGROUND })
    .jpeg({
      quality: JPEG_QUALITY,
      mozjpeg: true,
      progressive: true,
    })
    .toBuffer()
}

export async function imageBufferToCreateJpeg(bytes: Buffer): Promise<CreateImageJpeg> {
  const output = await sharp(bytes, { animated: false })
    .rotate()
    .resize({
      width: CREATE_IMAGE_MAX_DIMENSION,
      height: CREATE_IMAGE_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: JPEG_BACKGROUND })
    .jpeg({
      quality: CREATE_IMAGE_JPEG_QUALITY,
      mozjpeg: true,
      progressive: true,
    })
    .toBuffer({ resolveWithObject: true })

  return {
    bytes: output.data,
    width: output.info.width,
    height: output.info.height,
  }
}
