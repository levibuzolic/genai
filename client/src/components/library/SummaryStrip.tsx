import { Boxes, CircleAlert, ShieldCheck, Sparkles, Trash2 } from "lucide-react"

import type { ItemsResponse } from "@/types/domain"

import { SummaryPill } from "./SummaryPill"

export function SummaryStrip({
  facets,
  status,
  setStatus,
}: {
  facets: ItemsResponse["facets"]
  status: string
  setStatus: (value: string) => void
}) {
  return (
    <section id="summaryCards" className="summary-strip" aria-label="Collection summary">
      <SummaryPill
        label="Missing"
        value={facets.status?.missing || 0}
        icon={CircleAlert}
        tone="warning"
        active={status === "missing"}
        onClick={() => setStatus("missing")}
      />
      <SummaryPill
        label="Unverified"
        value={facets.status?.unverified || 0}
        icon={ShieldCheck}
        tone="info"
        active={status === "unverified"}
        onClick={() => setStatus("unverified")}
      />
      <SummaryPill
        label="Favorited"
        value={facets.status?.favorited || 0}
        icon={Sparkles}
        tone="success"
        active={status === "favorited"}
        onClick={() => setStatus("favorited")}
      />
      <SummaryPill
        label="Deleted"
        value={facets.status?.deleted || 0}
        icon={Trash2}
        tone="danger"
        active={status === "deleted"}
        onClick={() => setStatus("deleted")}
      />
      <SummaryPill label="Orphans" value={facets.orphanFiles || 0} icon={Boxes} tone="muted" />
    </section>
  )
}
