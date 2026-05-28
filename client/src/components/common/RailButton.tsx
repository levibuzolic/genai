import type * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function RailButton({
  icon: Icon,
  label,
  active,
  id,
  onClick,
}: {
  icon: React.ElementType
  label: string
  active?: boolean
  id?: string
  onClick?: () => void
}) {
  return (
    <Button
      id={id}
      className={cn("nav-button", active && "is-active")}
      type="button"
      variant={active ? "secondary" : "ghost"}
      aria-label={label}
      onClick={onClick}
    >
      <Icon className="size-5" />
      <span>{label}</span>
    </Button>
  )
}
