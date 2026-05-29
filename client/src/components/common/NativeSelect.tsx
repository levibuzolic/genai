import * as React from "react"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const EMPTY_SELECT_VALUE = "__empty"

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
      <SelectControl id={id} value={value} onChange={onChange}>
        {children}
      </SelectControl>
    </label>
  )
}

export function SelectControl({
  id,
  value,
  onChange,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  className?: string
  "aria-label"?: string
}) {
  const options = React.Children.toArray(children).filter(React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>)

  return (
    <Select value={toSelectValue(value)} onValueChange={(nextValue) => onChange(fromSelectValue(nextValue))}>
      <SelectTrigger id={id} className={cn("w-full", className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={String(option.props.value)}
            value={toSelectValue(String(option.props.value))}
            {...(option.props.disabled ? { disabled: true } : {})}
          >
            {option.props.children}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function toSelectValue(value: string) {
  return value === "" ? EMPTY_SELECT_VALUE : value
}

function fromSelectValue(value: string) {
  return value === EMPTY_SELECT_VALUE ? "" : value
}
