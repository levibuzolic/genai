import { Images, Link2, Upload } from "lucide-react"

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SourceKind } from "@/types/domain"

export function SourceTabs({ value, onChange }: { value: SourceKind; onChange: (value: SourceKind) => void }) {
  return (
    <Tabs value={value} onValueChange={(nextValue) => onChange(nextValue as SourceKind)}>
      <TabsList>
        <TabsTrigger value="catalog" data-source-kind="catalog">
          <Images />
          Collection
        </TabsTrigger>
        <TabsTrigger value="upload" data-source-kind="upload">
          <Upload />
          Upload
        </TabsTrigger>
        <TabsTrigger value="url" data-source-kind="url">
          <Link2 />
          URL
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
