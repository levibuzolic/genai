import { X } from "lucide-react"

import { Button } from "@/components/ui/button"

export function SelectedSourcePreview({
  id,
  url,
  label,
  onClear,
}: {
  id: string
  url?: string | null | undefined
  label: string
  onClear: () => void
}) {
  if (!url) return null

  return (
    <div id={id} className="selectedSourcePreview">
      <img src={url} alt={label} loading="lazy" decoding="async" />
      <div>
        <span>Selected source</span>
        <strong>{label}</strong>
      </div>
      <Button type="button" variant="ghost" size="icon-xs" onClick={onClear} aria-label="Clear selected source" title="Clear source">
        <X />
      </Button>
    </div>
  )
}
