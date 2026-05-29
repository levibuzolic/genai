const DATA_URL_FIELDS = new Set(["image_base64"])

export function redactDataUrlFields(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => {
      if (DATA_URL_FIELDS.has(key)) {
        return [key, "[image data URL omitted]"]
      }

      return [key, value]
    }),
  )
}
