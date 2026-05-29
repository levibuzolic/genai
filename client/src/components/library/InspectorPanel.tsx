import { Archive, RotateCcw } from "lucide-react"

import { SelectControl } from "@/components/common/NativeSelect"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { formatDate } from "@/lib/format"
import type { Backup } from "@/types/domain"

export function InspectorPanel({
  backups,
  selectedBackup,
  setSelectedBackup,
  onCreateBackup,
  onRestoreBackup,
}: {
  backups: Backup[]
  selectedBackup: string
  setSelectedBackup: (value: string) => void
  onCreateBackup: () => void
  onRestoreBackup: () => void
}) {
  return (
    <aside className="inspector-panel">
      <Card className="panel-card">
        <CardContent className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">Catalog</p>
              <h3 className="text-sm font-semibold">Backups</h3>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="backupSelect">Catalog backup</Label>
            <SelectControl id="backupSelect" value={selectedBackup} onChange={setSelectedBackup}>
              {backups.length === 0 ? (
                <option value="">No backups</option>
              ) : (
                backups.map((backup) => (
                  <option key={backup.file} value={backup.file}>
                    {formatDate(backup.createdAt)} · {backup.reason || "backup"} · {backup.itemCount || 0}
                  </option>
                ))
              )}
            </SelectControl>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={onCreateBackup}>
                <Archive />
                Backup
              </Button>
              <Button variant="outline" size="sm" disabled={!selectedBackup} onClick={onRestoreBackup}>
                <RotateCcw />
                Restore
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </aside>
  )
}
