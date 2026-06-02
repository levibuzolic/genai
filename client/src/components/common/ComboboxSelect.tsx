import { Check, ChevronDown, Search } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type ComboboxOption = {
  value: string
  label: string
  description?: string
  disabled?: boolean
  searchText?: string
}

export function ComboboxSelect({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = "Select",
  searchPlaceholder = "Filter options",
  emptyMessage = "No matches",
  className,
  triggerClassName,
  "aria-label": ariaLabel,
}: {
  id?: string
  label?: string
  value: string
  options: ComboboxOption[]
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  className?: string
  triggerClassName?: string
  "aria-label"?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const listboxId = React.useId()
  const selectedOption = options.find((option) => option.value === value)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        [option.label, option.description, option.searchText].some((entry) =>
          String(entry || "")
            .toLowerCase()
            .includes(normalizedQuery),
        ),
      )
    : options

  React.useEffect(() => {
    if (!open) return
    inputRef.current?.focus()

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer)
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer)
  }, [open])

  function selectOption(option: ComboboxOption) {
    if (option.disabled) return
    onChange(option.value)
    setQuery("")
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={cn("comboboxSelect", className)}>
      <Button
        id={id}
        type="button"
        variant="outline"
        className={cn("comboboxTrigger", triggerClassName)}
        aria-label={ariaLabel || label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        {label && <span className="comboboxLabel">{label}</span>}
        <span className="comboboxValue">{selectedOption?.label || placeholder}</span>
        <ChevronDown className="comboboxChevron" />
      </Button>
      {open && (
        <div className="comboboxPopover">
          <div className="comboboxSearch">
            <Search />
            <Input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault()
                  setOpen(false)
                }
                if (event.key === "Enter") {
                  const firstEnabled = filteredOptions.find((option) => !option.disabled)
                  if (firstEnabled) {
                    event.preventDefault()
                    selectOption(firstEnabled)
                  }
                }
              }}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </div>
          {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Custom filterable combobox needs listbox semantics. */}
          <div id={listboxId} className="comboboxOptions" role="listbox">
            {filteredOptions.map((option) => (
              <button
                key={option.value || "__empty"}
                type="button"
                className="comboboxOption"
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Buttons keep options clickable while preserving listbox semantics.
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                onClick={() => selectOption(option)}
              >
                <span className="comboboxOptionText">
                  <span>{option.label}</span>
                  {option.description && <small>{option.description}</small>}
                </span>
                {option.value === value && <Check />}
              </button>
            ))}
            {filteredOptions.length === 0 && <div className="comboboxEmpty">{emptyMessage}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
