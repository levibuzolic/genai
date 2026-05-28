import type * as React from "react"

import { cn } from "@/lib/utils"

export function SummaryPill({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string
  value: number
  icon: React.ElementType
  tone: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      className={cn("summaryCard", `tone-${tone}`, active && "is-active")}
      onClick={onClick}
      type="button"
      data-status-filter={label.toLowerCase()}
    >
      <Icon className="size-4" />
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </button>
  )
}
