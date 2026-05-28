import { Boxes, CircleAlert, ShieldCheck, Sparkles } from "lucide-react"
import type * as React from "react"

import type { ItemsResponse } from "@/types/domain"

import { SummaryPill } from "./SummaryPill"

export function SummaryStrip({
  facets,
  status,
  setStatus,
  setPage,
}: {
  facets: ItemsResponse["facets"]
  status: string
  setStatus: (value: string) => void
  setPage: React.Dispatch<React.SetStateAction<number>>
}) {
  return (
    <section id="summaryCards" className="summary-strip" aria-label="Collection summary">
      <SummaryPill
        label="Missing"
        value={facets.status?.missing || 0}
        icon={CircleAlert}
        tone="warning"
        active={status === "missing"}
        onClick={() => {
          setPage(1)
          setStatus("missing")
        }}
      />
      <SummaryPill
        label="Unverified"
        value={facets.status?.unverified || 0}
        icon={ShieldCheck}
        tone="info"
        active={status === "unverified"}
        onClick={() => {
          setPage(1)
          setStatus("unverified")
        }}
      />
      <SummaryPill
        label="Favorited"
        value={facets.status?.favorited || 0}
        icon={Sparkles}
        tone="success"
        active={status === "favorited"}
        onClick={() => {
          setPage(1)
          setStatus("favorited")
        }}
      />
      <SummaryPill label="Orphans" value={facets.orphanFiles || 0} icon={Boxes} tone="muted" />
    </section>
  )
}
