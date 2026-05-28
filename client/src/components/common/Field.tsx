import type * as React from "react"

export function Field({ id, label, children }: { id?: string; label: string; children: React.ReactNode }) {
  return (
    <div id={id} className="field">
      <label>{label}</label>
      {children}
    </div>
  )
}
