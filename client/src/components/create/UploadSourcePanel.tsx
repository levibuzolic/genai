import { Upload } from "lucide-react"

import { getImageFileFromTransfer } from "@/lib/upload"

import { SelectedSourcePreview } from "./SelectedSourcePreview"
import type { CreateStudioProps } from "./types"

export function UploadSourcePanel(props: CreateStudioProps) {
  return (
    <div id="uploadSourcePanel" className="sourcePanel">
      <button
        id="createUploadDropZone"
        type="button"
        aria-label="Choose, drop, or paste an image"
        className={props.isDraggingUpload ? "uploadDropZone is-dragging" : "uploadDropZone"}
        onClick={() => props.fileInputRef.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.setIsDraggingUpload(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = "copy"
          props.setIsDraggingUpload(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.setIsDraggingUpload(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          props.setIsDraggingUpload(false)
          void props.onUploadFile(getImageFileFromTransfer(event.dataTransfer), "drop")
        }}
      >
        <Upload className="size-5 text-primary" />
        <strong>Drop, paste, or browse</strong>
        <span>JPEG, PNG, WebP, or BMP</span>
      </button>
      <input
        id="createUploadInput"
        ref={props.fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp"
        aria-label="Choose image file"
        className="sr-only"
        onChange={(event) => void props.onUploadFile(event.currentTarget.files?.[0] || null, "picker")}
      />
      <p id="createUploadMeta" className="createHint">
        {props.uploadMeta}
      </p>
      <SelectedSourcePreview
        id="createSelectedUploadPreview"
        url={props.uploadedDataUrl}
        label={props.uploadedName || "Selected upload"}
        onClear={props.onClearSource}
      />
    </div>
  )
}
