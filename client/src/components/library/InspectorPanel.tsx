import { Archive, RotateCcw } from "lucide-react"

import { Metric } from "@/components/common/Metric"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { formatDate } from "@/lib/format"
import type { Backup, SyncStatus } from "@/types/domain"

export function InspectorPanel({
  syncStatus,
  backups,
  selectedBackup,
  setSelectedBackup,
  onCreateBackup,
  onRestoreBackup,
}: {
  syncStatus: SyncStatus
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
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pipeline</p>
              <h3 className="font-semibold">Local operations</h3>
            </div>
            <Badge variant={syncStatus.running ? "warning" : "success"}>{syncStatus.running ? "Running" : "Idle"}</Badge>
          </div>
          <div className="metric-grid">
            <Metric label="Scanned" value={syncStatus.scanned} />
            <Metric label="Downloaded" value={syncStatus.downloaded} />
            <Metric label="Skipped" value={syncStatus.skipped} />
            <Metric label="Errors" value={syncStatus.errors?.length || 0} />
          </div>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="backupSelect">Catalog backup</Label>
            <select
              id="backupSelect"
              className="native-select"
              value={selectedBackup}
              onChange={(event) => setSelectedBackup(event.target.value)}
            >
              {backups.length === 0 ? (
                <option value="">No backups</option>
              ) : (
                backups.map((backup) => (
                  <option key={backup.file} value={backup.file}>
                    {formatDate(backup.createdAt)} · {backup.reason || "backup"} · {backup.itemCount || 0}
                  </option>
                ))
              )}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="glass" size="sm" onClick={onCreateBackup}>
                <Archive />
                Backup
              </Button>
              <Button variant="glass" size="sm" disabled={!selectedBackup} onClick={onRestoreBackup}>
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
