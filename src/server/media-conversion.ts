import sharp from "sharp"

const JPEG_QUALITY = 92
const JPEG_BACKGROUND = { r: 255, g: 255, b: 255 }

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
