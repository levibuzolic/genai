import { X } from "lucide-react"

import { Button } from "@/components/ui/button"

export function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <Button className="chip" variant="glass" size="sm" onClick={onClear} data-clear-filter>
      {label}
      <X className="size-3" />
    </Button>
  )
}
