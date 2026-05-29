import * as React from "react"

import { fetchJson } from "@/lib/api"
import type { CreateTemplate } from "@/types/domain"
import type { CreateTemplateMutationResponse, CreateTemplatesResponse } from "@/types/routes"

export type TemplateDraft = {
  id?: string
  label: string
  description?: string
  type: CreateTemplate["type"]
  settings: CreateTemplate["settings"]
  workflow?: CreateTemplate["workflow"]
}

export function useTemplates() {
  const [templates, setTemplates] = React.useState<CreateTemplate[]>([])
  const [loading, setLoading] = React.useState(false)
  const [status, setStatus] = React.useState("Templates ready.")

  const loadTemplates = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchJson<CreateTemplatesResponse>("/api/create/templates")
      setTemplates(data.templates || [])
      setStatus(
        data.templates?.length ? `${data.templates.length} template${data.templates.length === 1 ? "" : "s"} loaded.` : "No templates yet.",
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  const saveTemplate = React.useCallback(
    async (draft: TemplateDraft) => {
      setStatus("Saving template...")
      const path = draft.id ? `/api/create/templates/${encodeURIComponent(draft.id)}` : "/api/create/templates"
      const response = await fetchJson<CreateTemplateMutationResponse>(path, {
        method: draft.id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      })
      await loadTemplates()
      setStatus(`Saved ${response.template.label}.`)
      return response.template
    },
    [loadTemplates],
  )

  const saveCreationAsTemplate = React.useCallback(
    async (creationId: string, label: string) => {
      setStatus("Saving creation as template...")
      const response = await fetchJson<CreateTemplateMutationResponse>(`/api/creations/${encodeURIComponent(creationId)}/template`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      })
      await loadTemplates()
      setStatus(`Saved ${response.template.label}.`)
      return response.template
    },
    [loadTemplates],
  )

  const deleteTemplate = React.useCallback(
    async (templateId: string) => {
      setStatus("Deleting template...")
      await fetchJson(`/api/create/templates/${encodeURIComponent(templateId)}`, { method: "DELETE" })
      await loadTemplates()
      setStatus("Template deleted.")
    },
    [loadTemplates],
  )

  return {
    templates,
    loading,
    status,
    loadTemplates,
    saveTemplate,
    saveCreationAsTemplate,
    deleteTemplate,
  }
}
