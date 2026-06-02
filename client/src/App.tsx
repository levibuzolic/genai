import * as React from "react"

import { AppShell } from "@/components/app/AppShell"
import { CreateStudio } from "@/components/create/CreateStudio"
import { LibraryView } from "@/components/library/LibraryView"
import { MediaDialog } from "@/components/media/MediaDialog"
import { TemplateBrowser, type CreateTemplateDraft } from "@/components/templates/TemplateBrowser"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAppNavigation } from "@/hooks/use-app-navigation"
import { useBackups } from "@/hooks/use-backups"
import { useConfig } from "@/hooks/use-config"
import { useCreateStudio } from "@/hooks/use-create-studio"
import { useCreationHistory } from "@/hooks/use-creation-history"
import { useLibrary } from "@/hooks/use-library"
import { usePreventIosViewportZoom } from "@/hooks/use-prevent-ios-viewport-zoom"
import { useSyncOperations } from "@/hooks/use-sync-operations"
import { useTemplates } from "@/hooks/use-templates"
import { fetchJson } from "@/lib/api"
import { copyTextToClipboard } from "@/lib/clipboard"
import { isTextEntryTarget } from "@/lib/keyboard"
import { isImageItem } from "@/lib/media"
import type {
  CatalogItem,
  CreateParams,
  CreationSource,
  DeleteCatalogItemResponse,
  FavoriteCatalogItemResponse,
  MediaFitMode,
} from "@/types/domain"

function App() {
  usePreventIosViewportZoom()

  const { route, navigateToCreate, navigateToItem, navigateToLibrary, navigateToPlaybox, navigateToSettings, navigateToTemplates } =
    useAppNavigation()
  const { config, reloadConfig } = useConfig()
  const activeView = route.view
  const library = useLibrary({ provider: activeView === "playbox" ? "playbox" : "generateporn" })
  const backups = useBackups(async () => {
    await library.loadItems()
  })
  const sync = useSyncOperations(
    () => {
      void library.loadItems({ keepLoading: true })
      void backups.loadBackups()
    },
    () => {
      void library.loadItems({ keepLoading: true })
    },
  )
  const create = useCreateStudio(navigateToCreate)
  const templates = useTemplates()
  const creationHistory = useCreationHistory(
    async (form) => {
      await create.openCreator({
        modeId: form.modeId || undefined,
        source: form.source || undefined,
        params: form.params,
      })
    },
    (transition) => {
      if (transition.hasDownloadableCompletion) {
        library.addOptimisticCreations(transition.downloadableCreations)
        void sync.startSync(true)
      } else if (transition.hasFailedCompletion) {
        void library.loadItems({ keepLoading: true })
      }
    },
  )
  const [selectedItem, setSelectedItem] = React.useState<CatalogItem | null>(null)
  const [copyFlash, setCopyFlash] = React.useState("")
  const [authActionPending, setAuthActionPending] = React.useState(false)
  const [settingsActionPending, setSettingsActionPending] = React.useState(false)
  const [deleteTarget, setDeleteTarget] = React.useState<CatalogItem | null>(null)
  const [deletePending, setDeletePending] = React.useState(false)
  const [keepLocalFiles, setKeepLocalFiles] = React.useState(true)
  const [mediaBlurred, setMediaBlurred] = React.useState(() => window.localStorage.getItem("mediaBlurred") === "true")
  const [mediaFitMode, setMediaFitMode] = React.useState<MediaFitMode>(() =>
    window.localStorage.getItem("mediaFitMode") === "contain" ? "contain" : "fill",
  )
  const [detailVideoMuted, setDetailVideoMuted] = React.useState(() => window.localStorage.getItem("detailVideoMuted") !== "false")
  const toggleMediaBlur = React.useCallback(() => setMediaBlurred((current) => !current), [])
  const createOpen = create.open
  const setCreateOpen = create.setOpen
  const setSelectedCreateAccountEmail = create.setSelectedAccountEmail
  const galleryItems = library.itemsData?.items ?? []
  const accountOptions = React.useMemo(() => config?.authAccounts?.map((account) => account.email) ?? [], [config?.authAccounts])
  const pendingGenerationCountsByAccount = React.useMemo(
    () => getPendingGenerationCountsByAccount(creationHistory.creations, config?.pendingGenerationsByAccount),
    [config?.pendingGenerationsByAccount, creationHistory.creations],
  )
  const queuedGenerationCountsByAccount = React.useMemo(
    () => getQueuedGenerationCountsByAccount(creationHistory.creations),
    [creationHistory.creations],
  )
  const autoCreateAccountEmail = React.useMemo(
    () =>
      getAutoCreateAccountEmail({
        accounts: accountOptions,
        defaultAccountEmail: config?.defaultAccountEmail || "",
        pendingCounts: pendingGenerationCountsByAccount,
        queuedCounts: queuedGenerationCountsByAccount,
      }),
    [accountOptions, config?.defaultAccountEmail, pendingGenerationCountsByAccount, queuedGenerationCountsByAccount],
  )
  const effectiveCreateAccountEmail = create.selectedAccountEmail || autoCreateAccountEmail
  const selectedItemIndex = selectedItem ? galleryItems.findIndex((item) => item.id === selectedItem.id) : -1
  const detailOpen = Boolean(selectedItem)
  const previousDetailItem = selectedItemIndex > 0 ? (galleryItems[selectedItemIndex - 1] ?? null) : null
  const nextDetailItem =
    selectedItemIndex >= 0 && selectedItemIndex < galleryItems.length - 1 ? (galleryItems[selectedItemIndex + 1] ?? null) : null

  React.useEffect(() => {
    setSelectedCreateAccountEmail((current) => {
      if (!accountOptions.length) return ""
      if (current && accountOptions.includes(current)) return current
      return ""
    })
  }, [accountOptions, setSelectedCreateAccountEmail])

  React.useEffect(() => {
    function onToast(event: Event) {
      const message = event instanceof CustomEvent && typeof event.detail?.message === "string" ? event.detail.message : ""
      if (!message) return

      setCopyFlash(message)
      window.setTimeout(() => setCopyFlash(""), 2400)
    }

    window.addEventListener("genai:toast", onToast)
    return () => window.removeEventListener("genai:toast", onToast)
  }, [])

  React.useEffect(() => {
    if (route.createOpen && !createOpen) {
      setCreateOpen(true)
    } else if (!route.createOpen && createOpen) {
      setCreateOpen(false)
    }
  }, [createOpen, route.createOpen, setCreateOpen])

  React.useEffect(() => {
    let cancelled = false

    async function loadRouteItem(itemId: string) {
      const pageItem = library.itemsData?.items.find((item) => item.id === itemId)
      if (pageItem) {
        setSelectedItem(pageItem)
        return
      }

      try {
        const data = await fetchJson<{ item: CatalogItem }>(`/api/items/${encodeURIComponent(itemId)}`)
        if (!cancelled) setSelectedItem(data.item)
      } catch (error) {
        if (cancelled) return
        setSelectedItem(null)
        setCopyFlash(error instanceof Error ? error.message : String(error))
        window.setTimeout(() => setCopyFlash(""), 1800)
        navigateToLibrary({ replace: true })
      }
    }

    if (!route.itemId) {
      setSelectedItem(null)
      return
    }

    if (selectedItem?.id === route.itemId) return
    void loadRouteItem(route.itemId)

    return () => {
      cancelled = true
    }
  }, [library.itemsData?.items, navigateToLibrary, route.itemId, selectedItem?.id])

  React.useEffect(() => {
    window.localStorage.setItem("mediaBlurred", String(mediaBlurred))
  }, [mediaBlurred])

  React.useEffect(() => {
    document.body.classList.toggle("media-blurred", mediaBlurred)
    return () => document.body.classList.remove("media-blurred")
  }, [mediaBlurred])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        !event.altKey ||
        event.code !== "KeyB" ||
        isTextEntryTarget(event.target)
      )
        return

      event.preventDefault()
      toggleMediaBlur()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [toggleMediaBlur])

  React.useEffect(() => {
    window.localStorage.setItem("mediaFitMode", mediaFitMode)
  }, [mediaFitMode])

  React.useEffect(() => {
    window.localStorage.setItem("detailVideoMuted", String(detailVideoMuted))
  }, [detailVideoMuted])

  React.useEffect(() => {
    const overlayOpen = create.open || detailOpen
    if (!overlayOpen) return

    const scrollY = window.scrollY
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    const previousBodyPosition = document.body.style.position
    const previousBodyTop = document.body.style.top
    const previousBodyWidth = document.body.style.width
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    document.body.style.position = "fixed"
    document.body.style.top = `-${scrollY}px`
    document.body.style.width = "100%"

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
      document.body.style.position = previousBodyPosition
      document.body.style.top = previousBodyTop
      document.body.style.width = previousBodyWidth
      window.scrollTo(0, scrollY)
    }
  }, [create.open, detailOpen])

  React.useEffect(() => {
    if (!create.open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") navigateToLibrary({ replace: true })
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [create.open, navigateToLibrary])

  async function copyValue(value: string | null | undefined, label: string) {
    if (!value) return
    try {
      await copyTextToClipboard(value)
      setCopyFlash(label)
      window.setTimeout(() => setCopyFlash(""), 1200)
    } catch (error) {
      setCopyFlash(error instanceof Error ? error.message : "Clipboard copy failed")
      window.setTimeout(() => setCopyFlash(""), 1800)
    }
  }

  async function runAuthBrowserAction(action: "connect" | "refresh" | "disconnect" | "remove", email?: string) {
    if (authActionPending) return
    setAuthActionPending(true)
    const path = email
      ? action === "connect"
        ? "/api/auth/accounts/connect"
        : action === "refresh"
          ? "/api/auth/accounts/refresh"
          : "/api/auth/accounts/remove"
      : action === "connect"
        ? "/api/auth/browser/connect"
        : action === "refresh"
          ? "/api/auth/browser/refresh"
          : "/api/auth/browser/disconnect"
    const body = email ? { email, deleteProfile: action === "remove" } : action === "disconnect" ? { deleteProfile: false } : {}
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

  async function runPlayboxAuthBrowserAction(action: "connect" | "refresh" | "disconnect") {
    if (authActionPending) return
    setAuthActionPending(true)
    const path =
      action === "connect"
        ? "/api/playbox/auth/browser/connect"
        : action === "refresh"
          ? "/api/playbox/auth/browser/refresh"
          : "/api/playbox/auth/browser/disconnect"
    try {
      const status = await fetchJson<{ message: string }>(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(action === "disconnect" ? { deleteProfile: false } : {}),
      })
      setCopyFlash(status.message)
      window.setTimeout(() => setCopyFlash(""), 1800)
      await reloadConfig()
    } finally {
      setAuthActionPending(false)
    }
  }

  async function importPlayboxCurl(curl: string) {
    if (settingsActionPending) return
    setSettingsActionPending(true)
    try {
      const status = await fetchJson<{ hasSession: boolean; cookieCount: number }>("/api/playbox/auth/import-curl", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ curl }),
      })
      setCopyFlash(status.hasSession ? `Imported ${status.cookieCount} Playbox cookies` : "Playbox import did not save a session")
      window.setTimeout(() => setCopyFlash(""), 1800)
      await reloadConfig()
    } finally {
      setSettingsActionPending(false)
    }
  }

  async function refreshPlayboxImport() {
    if (settingsActionPending) return
    setSettingsActionPending(true)
    try {
      const result = await fetchJson<{ ok: boolean }>("/api/playbox/auth/import/refresh", { method: "POST" })
      setCopyFlash(result.ok ? "Playbox imported session refreshed" : "Playbox imported session did not refresh")
      window.setTimeout(() => setCopyFlash(""), 1800)
      await reloadConfig()
    } finally {
      setSettingsActionPending(false)
    }
  }

  async function clearPlayboxImport() {
    if (settingsActionPending) return
    setSettingsActionPending(true)
    try {
      await fetchJson("/api/playbox/auth/import/disconnect", { method: "POST" })
      setCopyFlash("Playbox imported session cleared")
      window.setTimeout(() => setCopyFlash(""), 1800)
      await reloadConfig()
    } finally {
      setSettingsActionPending(false)
    }
  }

  async function saveMediaGenerationConcurrencyLimit(limit: number) {
    if (settingsActionPending) return
    setSettingsActionPending(true)
    try {
      const result = await fetchJson<{ limit: number }>("/api/settings/media-generation-concurrency-limit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit }),
      })
      setCopyFlash(`Generation limit set to ${result.limit}`)
      window.setTimeout(() => setCopyFlash(""), 1800)
      await reloadConfig()
    } finally {
      setSettingsActionPending(false)
    }
  }

  async function deleteRemoteItem() {
    if (!deleteTarget || deletePending) return

    setDeletePending(true)
    try {
      const result = await fetchJson<DeleteCatalogItemResponse>(`/api/items/${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keepLocalFiles }),
      })

      if (selectedItem?.id === deleteTarget.id) {
        setSelectedItem(result.item)
      }

      await library.loadItems({ keepLoading: true })
      setDeleteTarget(null)
      setKeepLocalFiles(true)
      setCopyFlash(keepLocalFiles ? "Remote deleted; local files kept" : "Remote and local files deleted")
      window.setTimeout(() => setCopyFlash(""), 1800)
    } finally {
      setDeletePending(false)
    }
  }

  function requestRemoteDelete(item: CatalogItem) {
    setDeleteTarget(item)
    setKeepLocalFiles(Boolean(item.localFile))
  }

  async function toggleFavorite(item: CatalogItem) {
    const favorited = !item.favorited
    const result = await fetchJson<FavoriteCatalogItemResponse>(`/api/items/${encodeURIComponent(item.id)}/favorite`, {
      method: favorited ? "POST" : "DELETE",
    })
    if (selectedItem?.id === item.id) {
      setSelectedItem(result.item)
    }
    await library.loadItems({ keepLoading: true })
  }

  return (
    <AppShell
      config={config}
      syncStatus={sync.syncStatus}
      createOpen={create.open}
      activeView={activeView}
      onOpenLibrary={() => {
        navigateToLibrary()
      }}
      onOpenPlaybox={() => {
        navigateToPlaybox()
      }}
      onOpenCreate={() => {
        void create.openCreator()
      }}
      onOpenTemplates={() => {
        navigateToTemplates()
      }}
      onStartSync={(incremental) => void sync.startSync(incremental)}
      onStartPlayboxSync={() => void sync.startPlayboxSync()}
      onStartDownload={(mode) => void sync.startDownload(mode)}
      onGenerateThumbnails={() => void sync.startThumbnailGeneration()}
      onVerifyLibrary={() => void sync.startLibraryVerification()}
      onCancelSync={() => void sync.cancelSync()}
      onAuthConnect={() => void runAuthBrowserAction("connect")}
      onAuthRefresh={() => void runAuthBrowserAction("refresh")}
      onAuthDisconnect={() => void runAuthBrowserAction("disconnect")}
      onPlayboxAuthConnect={() => void runPlayboxAuthBrowserAction("connect")}
      onPlayboxAuthRefresh={() => void runPlayboxAuthBrowserAction("refresh")}
      onPlayboxAuthDisconnect={() => void runPlayboxAuthBrowserAction("disconnect")}
      onImportPlayboxCurl={(curl) => void importPlayboxCurl(curl)}
      onRefreshPlayboxImport={() => void refreshPlayboxImport()}
      onClearPlayboxImport={() => void clearPlayboxImport()}
      onAuthAccountConnect={(email) => void runAuthBrowserAction("connect", email)}
      onAuthAccountRefresh={(email) => void runAuthBrowserAction("refresh", email)}
      onAuthAccountRemove={(email) => void runAuthBrowserAction("remove", email)}
      authActionPending={authActionPending}
      settingsActionPending={settingsActionPending}
      onSaveMediaGenerationConcurrencyLimit={(limit) => void saveMediaGenerationConcurrencyLimit(limit)}
      mediaBlurred={mediaBlurred}
      onToggleMediaBlur={toggleMediaBlur}
      mediaFitMode={mediaFitMode}
      onToggleMediaFitMode={() => setMediaFitMode((current) => (current === "fill" ? "contain" : "fill"))}
      settingsOpen={route.settingsOpen}
      settingsSection={route.settingsSection}
      onOpenSettings={() => navigateToSettings()}
      onCloseSettings={() => navigateToLibrary({ replace: true })}
      onSettingsSectionChange={(section) => navigateToSettings(section)}
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
          hasMoreItems={library.hasMoreItems}
          loadingMore={library.loadingMore}
          searchDraft={library.searchDraft}
          setSearchDraft={library.setSearchDraft}
          query={library.query}
          media={library.media}
          setMedia={library.setMedia}
          status={library.status}
          setStatus={library.setStatus}
          sort={library.sort}
          setSort={library.setSort}
          view={library.view}
          setView={library.setView}
          emptyTitle={activeView === "playbox" ? "No Playbox media found" : undefined}
          emptyDescription={activeView === "playbox" ? "Sync Playbox or adjust filters to browse downloaded Playbox creations." : undefined}
          clearFilters={library.clearFilters}
          onLoadMore={() => void library.loadNextPage()}
          onOpenCreate={(options) => void create.openCreator(options)}
          onDetails={(item) => navigateToItem(item.id, { view: activeView })}
          onCopyPrompt={(item) => void copyValue(item.prompt, "Prompt copied")}
          onDeleteRemote={requestRemoteDelete}
          onToggleFavorite={(item) => void toggleFavorite(item)}
        />
      )}

      <MediaDialog
        item={selectedItem}
        open={detailOpen}
        onOpenChange={(open) =>
          !open && (activeView === "playbox" ? navigateToPlaybox({ replace: true }) : navigateToLibrary({ replace: true }))
        }
        onCopy={(value, label) => void copyValue(value, label)}
        onCreate={(item) => {
          void create.openCreator({ sourceItem: item, prompt: "", modeId: "custom-video" })
        }}
        onAnimate={(item) => {
          void create.openCreator({ sourceItem: item, prompt: "", modeId: "custom-video" })
        }}
        onUsePrompt={(item) => {
          void create.openCreator({ sourceItem: isImageItem(item) ? item : null, prompt: item.prompt || undefined })
        }}
        onTryAgain={(item) => {
          void create.openCreator(buildRetryCreateOptions(item))
        }}
        onDeleteRemote={requestRemoteDelete}
        onToggleFavorite={(item) => void toggleFavorite(item)}
        previousItem={previousDetailItem}
        nextItem={nextDetailItem}
        videoMuted={detailVideoMuted}
        onVideoMutedChange={setDetailVideoMuted}
        onPrevious={() => {
          if (previousDetailItem) navigateToItem(previousDetailItem.id, { view: activeView })
        }}
        onNext={() => {
          if (nextDetailItem) navigateToItem(nextDetailItem.id, { view: activeView })
        }}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !deletePending) setDeleteTarget(null)
        }}
      >
        <DialogContent className="deleteDialog">
          <DialogHeader>
            <DialogTitle>Delete remote creation?</DialogTitle>
            <DialogDescription>{deleteTarget?.id}</DialogDescription>
          </DialogHeader>
          <label className="deleteKeepLocal">
            <input
              type="checkbox"
              aria-label="Keep local files"
              checked={keepLocalFiles}
              disabled={!deleteTarget?.localFile || deletePending}
              onChange={(event) => setKeepLocalFiles(event.currentTarget.checked)}
            />
            <span>Keep local files</span>
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deletePending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteRemoteItem()} disabled={deletePending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {create.open && (
        <dialog className="createOverlay" open aria-labelledby="createTitle">
          <button
            className="createOverlayBackdrop"
            type="button"
            aria-label="Close create"
            onClick={() => navigateToLibrary({ replace: true })}
          />
          <CreateStudio
            ref={create.panelRef}
            sourceKind={create.sourceKind}
            setSourceKind={create.setSourceKind}
            sourceItems={create.sourceItems}
            sourceItemsLoading={create.sourceItemsLoading}
            onSelectCatalogSource={create.onSelectCatalogSource}
            onRefreshCatalogSources={create.onRefreshCatalogSources}
            selectedSource={create.selectedSource}
            uploadMeta={create.uploadMeta}
            uploadedDataUrl={create.uploadedDataUrl}
            uploadedName={create.uploadedName}
            sourceUrl={create.sourceUrl}
            setSourceUrl={create.setSourceUrl}
            modes={create.modes}
            modeId={create.modeId}
            setModeId={create.setModeId}
            accountOptions={accountOptions}
            selectedAccountEmail={create.selectedAccountEmail}
            autoAccountEmail={autoCreateAccountEmail}
            setSelectedAccountEmail={create.setSelectedAccountEmail}
            pendingGenerationCountsByAccount={pendingGenerationCountsByAccount}
            queuedGenerationCountsByAccount={queuedGenerationCountsByAccount}
            pendingGenerationCount={getAccountPendingGenerationCount(pendingGenerationCountsByAccount, effectiveCreateAccountEmail)}
            queuedGenerationCount={getAccountQueuedGenerationCount(queuedGenerationCountsByAccount, effectiveCreateAccountEmail)}
            generationConcurrencyLimit={config?.mediaGenerationConcurrencyLimit || 2}
            prompt={create.prompt}
            setPrompt={create.setPrompt}
            negativePrompt={create.negativePrompt}
            setNegativePrompt={create.setNegativePrompt}
            promptField={create.promptField}
            modelId={create.modelId}
            setModelId={create.setModelId}
            modelField={create.modelField}
            quality={create.quality}
            setQuality={create.setQuality}
            qualityField={create.qualityField}
            createStatus={create.status}
            createSubmitting={create.submitting}
            isDraggingUpload={create.isDraggingUpload}
            setIsDraggingUpload={create.setIsDraggingUpload}
            fileInputRef={create.fileInputRef}
            onUploadFile={create.acceptUploadFile}
            onClearSource={create.clearSource}
            onSubmit={async (options) => {
              await create.submitCreateJob({ ...options, accountEmail: effectiveCreateAccountEmail })
              await creationHistory.loadCreations()
            }}
            onReset={create.resetCreateForm}
            onClose={() => navigateToLibrary({ replace: true })}
            templates={templates.templates}
            selectedTemplateId={create.selectedTemplateId}
            onApplyTemplate={create.applyTemplate}
            onClearTemplate={create.clearTemplate}
            templateType={create.templateType}
            setTemplateType={create.setTemplateType}
            onSaveCurrentTemplate={async (label, type) => {
              await templates.saveTemplate(create.buildTemplateDraft(label, type))
            }}
            onOpenTemplates={() => {
              navigateToTemplates()
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

      {copyFlash && (
        <output className="copy-toast" aria-live="polite">
          {copyFlash}
        </output>
      )}
    </AppShell>
  )
}

export default App

function getPendingGenerationCountsByAccount(
  creations: { accountEmail?: string | null; jobId?: string | null; status: string }[],
  serverCounts: Record<string, number> | undefined,
): Record<string, number> {
  const localCounts: Record<string, number> = {}
  for (const creation of creations) {
    if (!creation.jobId || !isActiveCreationStatus(creation.status) || isQueuedCreationStatus(creation.status)) continue
    const key = accountKey(creation.accountEmail)
    localCounts[key] = (localCounts[key] || 0) + 1
  }

  const counts: Record<string, number> = { ...serverCounts }
  for (const [key, count] of Object.entries(localCounts)) {
    counts[key] = Math.max(counts[key] || 0, count)
  }

  return counts
}

function getAccountPendingGenerationCount(counts: Record<string, number>, accountEmail: string): number {
  return counts[accountKey(accountEmail)] || 0
}

function getQueuedGenerationCountsByAccount(creations: { accountEmail?: string | null; status: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const creation of creations) {
    if (!isQueuedCreationStatus(creation.status)) continue
    const key = accountKey(creation.accountEmail)
    counts[key] = (counts[key] || 0) + 1
  }

  return counts
}

function getAccountQueuedGenerationCount(counts: Record<string, number>, accountEmail: string): number {
  return counts[accountKey(accountEmail)] || 0
}

function getAutoCreateAccountEmail({
  accounts,
  defaultAccountEmail,
  pendingCounts,
  queuedCounts,
}: {
  accounts: string[]
  defaultAccountEmail: string
  pendingCounts: Record<string, number>
  queuedCounts: Record<string, number>
}): string {
  if (accounts.length === 0) return ""

  let selected = accounts[0] || ""
  let selectedLoad = getAccountLoad(selected, pendingCounts, queuedCounts)

  for (const account of accounts) {
    const load = getAccountLoad(account, pendingCounts, queuedCounts)
    if (load < selectedLoad || (load === selectedLoad && account === defaultAccountEmail && selected !== defaultAccountEmail)) {
      selected = account
      selectedLoad = load
    }
  }

  return selected
}

function getAccountLoad(accountEmail: string, pendingCounts: Record<string, number>, queuedCounts: Record<string, number>): number {
  return getAccountPendingGenerationCount(pendingCounts, accountEmail) + getAccountQueuedGenerationCount(queuedCounts, accountEmail)
}

function buildRetryCreateOptions(item: CatalogItem): {
  accountEmail?: string | null
  modeId?: string
  params?: CreateParams
  source?: CreationSource | null
} {
  const options: {
    accountEmail?: string | null
    modeId?: string
    params?: CreateParams
    source?: CreationSource | null
  } = {
    modeId: item.createModeId || defaultCreateModeForItem(item),
    params: item.createParams || createParamsFromCatalogItem(item),
    source: createSourceFromCatalogItem(item),
  }
  if (item.accountEmail) options.accountEmail = item.accountEmail
  return options
}

function defaultCreateModeForItem(item: CatalogItem): string {
  return item.type === "image" ? "custom-image" : "custom-video"
}

function createParamsFromCatalogItem(item: CatalogItem): CreateParams {
  const params: CreateParams = {}
  if (item.prompt) params["prompt"] = item.prompt
  if (item.negativePrompt) params["negativePrompt"] = item.negativePrompt
  if (item.modelId || item.model_id) params["modelId"] = item.modelId || item.model_id
  if (item.duration) params["quality"] = `1080p-${item.duration}`
  return params
}

function createSourceFromCatalogItem(item: CatalogItem): CreationSource | null {
  if (item.sourceKind === "catalog" && item.sourceItemId) {
    return { kind: "catalog", itemId: item.sourceItemId }
  }
  if (item.sourceKind === "url" && item.sourceUrl) {
    return { kind: "url", url: item.sourceUrl }
  }
  if (item.sourceKind === "upload") {
    return { kind: "upload" }
  }
  if (item.inputUrl) {
    return { kind: "url", url: item.inputUrl }
  }
  return null
}

function isActiveCreationStatus(status: string): boolean {
  const normalized = status.toLowerCase()
  return !["done", "failed", "error", "cancelled", "canceled", "draft"].includes(normalized)
}

function isQueuedCreationStatus(status: string): boolean {
  return status.toLowerCase() === "queued"
}

function accountKey(accountEmail: string | null | undefined): string {
  return accountEmail || "__default__"
}
