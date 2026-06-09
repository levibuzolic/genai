import { Clock3, CopyPlus, ExternalLink, ImagePlus, RefreshCw, Save, Search } from "lucide-react"
import * as React from "react"

import { SelectControl } from "@/components/common/NativeSelect"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { formatDate, formatTime } from "@/lib/format"
import type { Creation, CreationEvent } from "@/types/domain"

type CreationHistoryFilter = {
  media: string
  query: string
  source: string
  status: string
}

const DEFAULT_FILTERS: CreationHistoryFilter = {
  media: "",
  query: "",
  source: "",
  status: "",
}

export function CreationHistoryView({
  creations,
  loading,
  selectedCreation,
  selectedEvents,
  statusMessage,
  onCloseDetails,
  onRefresh,
  onDetails,
  onDuplicate,
  onRetry,
  onSaveTemplate,
}: {
  creations: Creation[]
  loading: boolean
  selectedCreation: Creation | null
  selectedEvents: CreationEvent[]
  statusMessage: string
  onCloseDetails: () => void
  onRefresh: () => Promise<void>
  onDetails: (creation: Creation) => Promise<void>
  onDuplicate: (creation: Creation, options?: { includeSource?: boolean }) => Promise<void>
  onRetry: (creation: Creation) => Promise<void>
  onSaveTemplate: (creation: Creation) => Promise<void>
}) {
  const [filters, setFilters] = React.useState<CreationHistoryFilter>(DEFAULT_FILTERS)
  const filteredCreations = React.useMemo(() => filterCreations(creations, filters), [creations, filters])
  const statusOptions = React.useMemo(() => uniqueSorted(creations.map((creation) => creation.status)), [creations])
  const mediaOptions = React.useMemo(() => uniqueSorted(creations.map((creation) => creation.mediaType || "")), [creations])
  const sourceOptions = React.useMemo(() => uniqueSorted(creations.map((creation) => creation.source?.kind || "")), [creations])

  function updateFilter(key: keyof CreationHistoryFilter, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <section className="creationHistoryView" aria-label="Creation attempts history">
      <header className="creationHistoryViewHeader">
        <div>
          <Badge variant="secondary">
            <Clock3 className="size-3" />
            History
          </Badge>
          <h2>Creation attempts</h2>
          <p>
            {filteredCreations.length.toLocaleString()} of {creations.length.toLocaleString()} attempts
            {statusMessage ? ` · ${statusMessage}` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void onRefresh()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </header>

      <section className="creationHistoryFilters" aria-label="History filters">
        <div className="creationHistorySearch">
          <Search className="size-4" />
          <Input
            id="creationHistorySearchInput"
            value={filters.query}
            onChange={(event) => updateFilter("query", event.currentTarget.value)}
            placeholder="Search prompts, ids, templates, errors"
            aria-label="Search creation history"
          />
        </div>
        <SelectControl value={filters.status} onChange={(value) => updateFilter("status", value)} aria-label="Filter status">
          <option value="">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </SelectControl>
        <SelectControl value={filters.media} onChange={(value) => updateFilter("media", value)} aria-label="Filter media type">
          <option value="">All media</option>
          {mediaOptions.map((media) => (
            <option key={media} value={media}>
              {media}
            </option>
          ))}
        </SelectControl>
        <SelectControl value={filters.source} onChange={(value) => updateFilter("source", value)} aria-label="Filter source">
          <option value="">All sources</option>
          {sourceOptions.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </SelectControl>
        <Button type="button" variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
          Clear
        </Button>
      </section>

      <div className="creationHistoryTableFrame">
        <table className="creationHistoryTable" aria-label="Creation attempts">
          <thead>
            <tr>
              <th>Attempt</th>
              <th>Status</th>
              <th>Mode</th>
              <th>Source</th>
              <th>Updated</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCreations.map((creation) => (
              <tr key={creation.id}>
                <td>
                  <button type="button" className="creationHistoryAttempt" onClick={() => void onDetails(creation)}>
                    <strong>{creationTitle(creation)}</strong>
                    <span>{creation.id}</span>
                    {creation.error && <em>{creation.error}</em>}
                  </button>
                </td>
                <td>
                  <Badge variant={statusVariant(creation.status)}>{statusLabel(creation.status)}</Badge>
                </td>
                <td>{creation.modeLabel || creation.modeId || ""}</td>
                <td>{sourceLabel(creation)}</td>
                <td>
                  <time>{formatDate(creationTime(creation))}</time>
                </td>
                <td>
                  <span className="creationHistoryTableActions">
                    {isErrorCreationStatus(creation.status) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-xs"
                        onClick={() => void onRetry(creation)}
                        aria-label="Retry creation"
                        title="Retry creation"
                      >
                        <RefreshCw />
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      onClick={() => void onDuplicate(creation)}
                      aria-label="Copy settings"
                    >
                      <CopyPlus />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      onClick={() => void onDuplicate(creation, { includeSource: true })}
                      aria-label="Copy settings and source"
                    >
                      <ImagePlus />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-xs"
                      onClick={() => void onSaveTemplate(creation)}
                      aria-label="Save template"
                    >
                      <Save />
                    </Button>
                    {creation.outputUrl && (
                      <Button type="button" variant="outline" size="icon-xs" asChild>
                        <a href={creation.outputUrl} target="_blank" rel="noreferrer" aria-label="Open output">
                          <ExternalLink />
                        </a>
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filteredCreations.length && <div className="creationHistoryNoResults">No creation attempts match the current filters.</div>}
      </div>

      <Dialog open={Boolean(selectedCreation)} onOpenChange={(open) => !open && onCloseDetails()}>
        <DialogContent className="creationDetailDialog">
          {selectedCreation && (
            <>
              <DialogHeader className="dialogHeader">
                <DialogTitle>{selectedCreation.modeLabel || selectedCreation.modeId || "Creation details"}</DialogTitle>
                <DialogDescription>
                  {[selectedCreation.jobId, sourceLabel(selectedCreation), formatDate(creationTime(selectedCreation))]
                    .filter(Boolean)
                    .join(" · ")}
                </DialogDescription>
              </DialogHeader>
              <div className="creationDetailBody">
                <section className="creationDetailSummary">
                  <Badge variant={statusVariant(selectedCreation.status)}>{statusLabel(selectedCreation.status)}</Badge>
                  <p>{creationTitle(selectedCreation)}</p>
                  <div className="dialogActions">
                    {isErrorCreationStatus(selectedCreation.status) && (
                      <Button onClick={() => void onRetry(selectedCreation)}>
                        <RefreshCw />
                        Retry
                      </Button>
                    )}
                    <Button onClick={() => void onDuplicate(selectedCreation)}>
                      <CopyPlus />
                      Copy settings
                    </Button>
                    <Button variant="outline" onClick={() => void onDuplicate(selectedCreation, { includeSource: true })}>
                      <ImagePlus />
                      Copy with source
                    </Button>
                    <Button variant="outline" onClick={() => void onSaveTemplate(selectedCreation)}>
                      <Save />
                      Save template
                    </Button>
                    {selectedCreation.outputUrl && (
                      <Button variant="outline" asChild>
                        <a href={selectedCreation.outputUrl} target="_blank" rel="noreferrer">
                          <ExternalLink />
                          Open output
                        </a>
                      </Button>
                    )}
                  </div>
                </section>

                <section>
                  <h4>Timeline</h4>
                  <ol className="creationTimeline">
                    {selectedEvents.map((event) => (
                      <li key={event.id}>
                        <Clock3 className="size-3" />
                        <div>
                          <strong>{statusLabel(event.status)}</strong>
                          {event.message && <span>{event.message}</span>}
                        </div>
                        <time>{formatTime(event.createdAt)}</time>
                      </li>
                    ))}
                  </ol>
                </section>

                <section>
                  <h4>Settings</h4>
                  <dl className="detailFacts">
                    <dt>Mode</dt>
                    <dd>{selectedCreation.modeLabel || selectedCreation.modeId}</dd>
                    <dt>Source</dt>
                    <dd>{sourceLabel(selectedCreation)}</dd>
                    <dt>Prompt</dt>
                    <dd>{selectedCreation.params?.["prompt"] || "Preset prompt"}</dd>
                    <dt>Quality</dt>
                    <dd>{selectedCreation.params?.["quality"] || (selectedCreation.job?.["resolution"] as string | undefined) || ""}</dd>
                    <dt>Output</dt>
                    <dd>{selectedCreation.outputUrl || ""}</dd>
                    <dt>Error</dt>
                    <dd>{selectedCreation.error || ""}</dd>
                  </dl>
                </section>

                <section>
                  <h4>Request</h4>
                  <pre className="creationJson">{JSON.stringify(selectedCreation.request || {}, null, 2)}</pre>
                </section>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function filterCreations(creations: Creation[], filters: CreationHistoryFilter): Creation[] {
  const query = filters.query.trim().toLowerCase()
  return creations.filter((creation) => {
    if (filters.status && creation.status !== filters.status) return false
    if (filters.media && creation.mediaType !== filters.media) return false
    if (filters.source && creation.source?.kind !== filters.source) return false
    if (!query) return true

    return [
      creation.id,
      creation.jobId,
      creation.modeId,
      creation.modeLabel,
      creation.templateLabel,
      creation.params?.["prompt"],
      creation.params?.["negativePrompt"],
      creation.error,
      creation.source?.kind,
      sourceUrlForSearch(creation),
      sourceItemForSearch(creation),
    ].some((value) =>
      String(value || "")
        .toLowerCase()
        .includes(query),
    )
  })
}

function uniqueSorted(values: Array<string | null | undefined>): string[] {
  const sorted: string[] = []
  for (const value of new Set(values.filter((entry): entry is string => Boolean(entry)))) {
    const index = sorted.findIndex((entry) => value.localeCompare(entry) < 0)
    if (index === -1) {
      sorted.push(value)
    } else {
      sorted.splice(index, 0, value)
    }
  }
  return sorted
}

function sourceUrlForSearch(creation: Creation): string {
  return creation.source && "url" in creation.source && typeof creation.source.url === "string" ? creation.source.url : ""
}

function sourceItemForSearch(creation: Creation): string {
  return creation.source && "itemId" in creation.source && typeof creation.source.itemId === "string" ? creation.source.itemId : ""
}

function statusVariant(status: string) {
  if (["failed", "error", "cancelled", "canceled"].includes(status)) return "destructive"
  if (["done", "success", "completed"].includes(status)) return "default"
  if (status === "draft") return "secondary"
  return "outline"
}

function statusLabel(status: string) {
  return status.replace(/_/g, " ")
}

function isErrorCreationStatus(status: string) {
  return ["failed", "error"].includes(status.toLowerCase())
}

function sourceLabel(creation: Creation) {
  if (creation.source?.kind === "catalog") {
    const itemId = typeof creation.source.itemId === "string" ? creation.source.itemId : ""
    return itemId ? `Collection ${itemId.slice(0, 8)}` : "Collection source"
  }
  if (creation.source?.kind === "url") return "URL source"
  if (creation.source?.kind === "upload") return "Upload source"
  return "No source"
}

function creationTitle(creation: Creation) {
  const prompt = creation.params?.["prompt"] || creation.job?.["prompt"]
  if (typeof prompt === "string" && prompt) return prompt
  return creation.modeLabel || creation.modeId || "Creation"
}

function creationTime(creation: Creation) {
  return (
    creation.finishedAt ||
    creation.updatedAt ||
    creation.submittedAt ||
    creation.createdLocallyAt ||
    creation.createdAtIso ||
    creation.createdAt
  )
}
