import type * as React from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function RailButton({
  icon: Icon,
  label,
  active,
  id,
  onClick,
  className,
}: {
  icon: React.ElementType
  label: string
  active?: boolean
  id?: string
  onClick?: () => void
  className?: string
}) {
  return (
    <Button
      id={id}
      className={cn("h-9 w-full justify-start px-2.5 text-muted-foreground", active && "text-foreground", className)}
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
