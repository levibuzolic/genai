import * as React from "react"

import { fetchJson } from "@/lib/api"
import type { Backup } from "@/types/domain"
import type { CatalogBackupsResponse, CatalogBackupResponse, CatalogRestoreResponse } from "@/types/routes"

export function useBackups(onRestore: () => Promise<void>) {
  const [backups, setBackups] = React.useState<Backup[]>([])
  const [selectedBackup, setSelectedBackup] = React.useState("")

  React.useEffect(() => {
    void loadBackups()
  }, [])

  async function loadBackups() {
    const data = await fetchJson<CatalogBackupsResponse>("/api/catalog/backups")
    setBackups(data.backups || [])
    setSelectedBackup((current) => current || data.backups?.[0]?.file || "")
  }

  async function createCatalogBackup() {
    await fetchJson<CatalogBackupResponse>("/api/catalog/backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "manual" }),
    })
    await loadBackups()
  }

  async function restoreCatalogBackup() {
    if (!selectedBackup) return
    await fetchJson<CatalogRestoreResponse>("/api/catalog/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: selectedBackup }),
    })
    await onRestore()
    await loadBackups()
  }

  return {
    backups,
    selectedBackup,
    setSelectedBackup,
    loadBackups,
    createCatalogBackup,
    restoreCatalogBackup,
  }
}
