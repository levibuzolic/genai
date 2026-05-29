import * as React from "react"

import { AppShell } from "@/components/app/AppShell"
import { CreateStudio } from "@/components/create/CreateStudio"
import { LibraryView } from "@/components/library/LibraryView"
import { MediaDialog } from "@/components/media/MediaDialog"
import { TemplateBrowser, type CreateTemplateDraft } from "@/components/templates/TemplateBrowser"
import { useBackups } from "@/hooks/use-backups"
import { useConfig } from "@/hooks/use-config"
import { useCreateStudio } from "@/hooks/use-create-studio"
import { useCreationHistory } from "@/hooks/use-creation-history"
import { useLibrary } from "@/hooks/use-library"
import { useSyncOperations } from "@/hooks/use-sync-operations"
import { useTemplates } from "@/hooks/use-templates"
import { fetchJson } from "@/lib/api"
import { isImageItem } from "@/lib/media"
import type { CatalogItem, MediaFitMode } from "@/types/domain"

function App() {
  const { config, reloadConfig } = useConfig()
  const library = useLibrary()
  const backups = useBackups(async () => {
    await library.loadItems()
  })
  const sync = useSyncOperations(() => {
    void library.loadItems({ keepLoading: true })
    void backups.loadBackups()
  })
  const create = useCreateStudio(async () => {
    await library.loadItems({ keepLoading: true })
  })
  const templates = useTemplates()
  const creationHistory = useCreationHistory(async (form) => {
    await create.openCreator({
      modeId: form.modeId || undefined,
      source: form.source || undefined,
      params: form.params,
    })
  })
  const [selectedItem, setSelectedItem] = React.useState<CatalogItem | null>(null)
  const [activeView, setActiveView] = React.useState<"library" | "templates">("library")
  const [copyFlash, setCopyFlash] = React.useState("")
  const [authActionPending, setAuthActionPending] = React.useState(false)
  const [mediaBlurred, setMediaBlurred] = React.useState(() => window.localStorage.getItem("mediaBlurred") === "true")
  const [mediaFitMode, setMediaFitMode] = React.useState<MediaFitMode>(() =>
    window.localStorage.getItem("mediaFitMode") === "contain" ? "contain" : "fill",
  )
  const setCreateOpen = create.setOpen

  React.useEffect(() => {
    window.localStorage.setItem("mediaBlurred", String(mediaBlurred))
  }, [mediaBlurred])

  React.useEffect(() => {
    window.localStorage.setItem("mediaFitMode", mediaFitMode)
  }, [mediaFitMode])

  React.useEffect(() => {
    if (!create.open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setCreateOpen(false)
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [create.open, setCreateOpen])

  async function copyValue(value: string | undefined, label: string) {
    if (!value) return
    await navigator.clipboard.writeText(value)
    setCopyFlash(label)
    window.setTimeout(() => setCopyFlash(""), 1200)
  }

  async function runAuthBrowserAction(action: "connect" | "refresh" | "disconnect") {
    if (authActionPending) return
    setAuthActionPending(true)
    const path =
      action === "connect"
        ? "/api/auth/browser/connect"
        : action === "refresh"
          ? "/api/auth/browser/refresh"
          : "/api/auth/browser/disconnect"
    const body = action === "disconnect" ? { deleteProfile: false } : {}
    try {
      const status = await fetchJson<{ message: string }>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      setCopyFlash(status.message)
      window.setTimeout(() => setCopyFlash(""), 1800)
      await reloadConfig()
    } finally {
      setAuthActionPending(false)
    }
  }

  return (
    <AppShell
      config={config}
      syncStatus={sync.syncStatus}
      createOpen={create.open}
      activeView={activeView}
      onOpenLibrary={() => {
        create.setOpen(false)
        setActiveView("library")
      }}
      onOpenCreate={() => {
        setActiveView("library")
        void create.openCreator()
      }}
      onOpenTemplates={() => {
        create.setOpen(false)
        setActiveView("templates")
      }}
      onStartSync={(incremental) => void sync.startSync(incremental)}
      onStartDownload={(mode) => void sync.startDownload(mode)}
      onGenerateThumbnails={() => void sync.startThumbnailGeneration()}
      onVerifyLibrary={() => void sync.startLibraryVerification()}
      onCancelSync={() => void sync.cancelSync()}
      onAuthConnect={() => void runAuthBrowserAction("connect")}
      onAuthRefresh={() => void runAuthBrowserAction("refresh")}
      onAuthDisconnect={() => void runAuthBrowserAction("disconnect")}
      authActionPending={authActionPending}
      mediaBlurred={mediaBlurred}
      onToggleMediaBlur={() => setMediaBlurred((current) => !current)}
      mediaFitMode={mediaFitMode}
      onToggleMediaFitMode={() => setMediaFitMode((current) => (current === "fill" ? "contain" : "fill"))}
      backups={backups.backups}
      selectedBackup={backups.selectedBackup}
      setSelectedBackup={backups.setSelectedBackup}
      onCreateBackup={() => void backups.createCatalogBackup()}
      onRestoreBackup={() => void backups.restoreCatalogBackup()}
    >
      {activeView === "templates" ? (
        <TemplateBrowser
          templates={templates.templates}
          modes={create.modes}
          loading={templates.loading}
          status={templates.status}
          onUseTemplate={(template) => {
            setActiveView("library")
            void create.openCreator({ templateId: template.id })
            create.applyTemplate(template)
          }}
          onSaveTemplate={async (draft: CreateTemplateDraft) => {
            await templates.saveTemplate(draft)
          }}
          onDeleteTemplate={templates.deleteTemplate}
        />
      ) : (
        <LibraryView
          itemsData={library.itemsData}
          itemsLoading={library.itemsLoading}
          deferredItems={library.deferredItems}
          pending={library.pending}
          searchDraft={library.searchDraft}
          setSearchDraft={library.setSearchDraft}
          query={library.query}
          media={library.media}
          setMedia={library.setMedia}
          status={library.status}
          setStatus={library.setStatus}
          sort={library.sort}
          setSort={library.setSort}
          pageSize={library.pageSize}
          setPageSize={library.setPageSize}
          page={library.page}
          setPage={library.setPage}
          view={library.view}
          setView={library.setView}
          clearFilters={library.clearFilters}
          onOpenCreate={(options) => void create.openCreator(options)}
          onDetails={setSelectedItem}
          onCopyPrompt={(item) => void copyValue(item.prompt, "Prompt copied")}
        />
      )}

      <MediaDialog
        item={selectedItem}
        open={Boolean(selectedItem)}
        onOpenChange={(open) => !open && setSelectedItem(null)}
        onCopy={(value, label) => void copyValue(value, label)}
        onCreate={(item) => {
          setSelectedItem(null)
          void create.openCreator({ sourceItem: item, prompt: item.prompt })
        }}
        onAnimate={(item) => {
          setSelectedItem(null)
          void create.openCreator({ sourceItem: item, prompt: item.prompt, modeId: "custom-video" })
        }}
        onUsePrompt={(item) => {
          setSelectedItem(null)
          void create.openCreator({ sourceItem: isImageItem(item) ? item : null, prompt: item.prompt })
        }}
      />

      {create.open && (
        <dialog className="createOverlay" open aria-labelledby="createTitle">
          <button className="createOverlayBackdrop" type="button" aria-label="Close create" onClick={() => setCreateOpen(false)} />
          <CreateStudio
            ref={create.panelRef}
            sourceKind={create.sourceKind}
            setSourceKind={create.setSourceKind}
            selectedSource={create.selectedSource}
            uploadMeta={create.uploadMeta}
            uploadedDataUrl={create.uploadedDataUrl}
            uploadedName={create.uploadedName}
            sourceUrl={create.sourceUrl}
            setSourceUrl={create.setSourceUrl}
            modes={create.modes}
            modeId={create.modeId}
            setModeId={create.setModeId}
            prompt={create.prompt}
            setPrompt={create.setPrompt}
            promptField={create.promptField}
            quality={create.quality}
            setQuality={create.setQuality}
            qualityField={create.qualityField}
            createStatus={create.status}
            createResult={create.result}
            createSubmitting={create.submitting}
            isDraggingUpload={create.isDraggingUpload}
            setIsDraggingUpload={create.setIsDraggingUpload}
            fileInputRef={create.fileInputRef}
            onUploadFile={create.acceptUploadFile}
            onClearSource={create.clearSource}
            onSubmit={async () => {
              await create.submitCreateJob()
              await creationHistory.loadCreations()
            }}
            onReset={create.resetCreateForm}
            onClose={() => create.setOpen(false)}
            onDownload={async () => {
              await create.downloadCreateJob()
              await creationHistory.loadCreations()
              await templates.loadTemplates()
            }}
            onAnimate={create.animateCreateResult}
            templates={templates.templates}
            templateSearch={create.templateSearch}
            setTemplateSearch={create.setTemplateSearch}
            selectedTemplateId={create.selectedTemplateId}
            onApplyTemplate={create.applyTemplate}
            onClearTemplate={create.clearTemplate}
            templateType={create.templateType}
            setTemplateType={create.setTemplateType}
            onSaveCurrentTemplate={async (label, type) => {
              await templates.saveTemplate(create.buildTemplateDraft(label, type))
            }}
            onOpenTemplates={() => {
              create.setOpen(false)
              setActiveView("templates")
            }}
            templateJobId={create.templateJobId}
            setTemplateJobId={create.setTemplateJobId}
            templateLabel={create.templateLabel}
            setTemplateLabel={create.setTemplateLabel}
            onImportTemplate={async () => {
              await create.importTemplate()
              await templates.loadTemplates()
            }}
            creations={creationHistory.creations}
            activeCreationCount={creationHistory.activeCount}
            creationHistoryLoading={creationHistory.loading}
            selectedCreation={creationHistory.selectedCreation}
            selectedCreationEvents={creationHistory.selectedEvents}
            creationHistoryStatus={creationHistory.statusMessage}
            onRefreshCreations={creationHistory.refreshNow}
            onCreationDetails={creationHistory.openDetails}
            onCloseCreationDetails={() => creationHistory.setSelectedCreation(null)}
            onDuplicateCreation={creationHistory.duplicateSettings}
            onSaveCreationTemplate={async (creation) => {
              const label = creation.params?.["prompt"] || creation.modeLabel || creation.modeId || "Saved creation"
              await templates.saveCreationAsTemplate(creation.id, String(label).slice(0, 80))
            }}
          />
        </dialog>
      )}

      {copyFlash && <div className="copy-toast">{copyFlash}</div>}
    </AppShell>
  )
}

export default App
