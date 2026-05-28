import type * as React from "react"

import { cn } from "@/lib/utils"

export function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ElementType
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button className={cn("rail-button", active && "is-active")} type="button" aria-label={label} onClick={onClick}>
      <Icon className="size-5" />
    </button>
  )
}
