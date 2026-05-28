import { Database } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { formatNumber } from "@/lib/format"

export function LibraryHero({ total, progressValue }: { total: number; progressValue: number }) {
  return (
    <section className="hero-panel">
      <div>
        <Badge variant="muted">
          <Database className="size-3" />
          {formatNumber(total)} assets
        </Badge>
        <h2>Review, remix, and keep the local collection tidy.</h2>
        <p>A dense media console for finding source images, launching edits, and keeping generated work downloaded.</p>
      </div>
      <div className="hero-meter">
        <div>
          <span>{progressValue}%</span>
          <p>downloaded</p>
        </div>
        <Progress value={progressValue} />
      </div>
    </section>
  )
}
