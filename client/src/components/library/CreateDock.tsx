import { ExternalLink, ImageIcon, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"

import type { OpenCreateOptions } from "./types"

export function CreateDock({ onOpenCreate }: { onOpenCreate: (options?: OpenCreateOptions) => void }) {
  return (
    <section className="createDock" aria-label="Start creating">
      <div>
        <strong>Create from feed</strong>
        <span>Start from collection, upload, clipboard, or a URL.</span>
      </div>
      <div className="createDockActions">
        <Button variant="glass" data-open-create-source="catalog" onClick={() => onOpenCreate({ sourceKind: "catalog" })}>
          <ImageIcon />
          Collection
        </Button>
        <Button variant="glass" data-open-create-source="upload" onClick={() => onOpenCreate({ sourceKind: "upload" })}>
          <Upload />
          Upload
        </Button>
        <Button variant="glass" data-open-create-source="url" onClick={() => onOpenCreate({ sourceKind: "url" })}>
          <ExternalLink />
          URL
        </Button>
      </div>
    </section>
  )
}
