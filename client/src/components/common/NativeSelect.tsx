import type * as React from "react"

import { cn } from "@/lib/utils"

export function NativeSelect({
  id,
  label,
  value,
  onChange,
  className,
  children,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={cn("native-select-field", className)}>
      <span>{label}</span>
      <select id={id} className="native-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  )
}
