import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { SourceKind } from "@/types/domain"

export function SourceTabs({ value, onChange }: { value: SourceKind; onChange: (value: SourceKind) => void }) {
  return (
    <Tabs value={value} onValueChange={(nextValue) => onChange(nextValue as SourceKind)}>
      <TabsList className="createTabs grid w-full grid-cols-3">
        <TabsTrigger className="sourceTab" value="catalog" data-source-kind="catalog">
          Collection
        </TabsTrigger>
        <TabsTrigger className="sourceTab" value="upload" data-source-kind="upload">
          Upload
        </TabsTrigger>
        <TabsTrigger className="sourceTab" value="url" data-source-kind="url">
          URL
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
