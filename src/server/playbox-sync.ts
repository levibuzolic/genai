import { createHash } from "node:crypto"
import { mkdir, rename, writeFile } from "node:fs/promises"
import path from "node:path"

import {
  findPlayboxAsset,
  savePlayboxAsset,
  savePlayboxCollection,
  type PlayboxAssetRecord,
  type PlayboxCollectionRecord,
} from "./catalog-db.ts"
import { ensureCatalogThumbnail, toPublicCatalogItem } from "./catalog.ts"
import { loadCatalog, saveCatalog, sortItems } from "./catalog.ts"
import { MEDIA_DIR, PLAYBOX_PAGE_LIMIT, SYNC_DELAY_MS } from "./config.ts"
import { fetchPlayboxCollectionsPage } from "./playbox-api-client.ts"
import { recordOrNull, stringOrNull } from "./refinements.ts"
import { finishSyncRun, resetSyncState, shouldStopForCancellation, syncState } from "./sync.ts"
import type { CatalogItem, PlayboxCollection } from "./types.ts"
import { contentTypeFor, hashBuffer, sanitizePathPart, sleep } from "./utils.ts"

type PlayboxAssetKind =
  | "output-video"
  | "compressed-video"
  | "poster"
  | "output-image"
  | "audio"
  | "input-image"
  | "resized-input-image"
  | "input-video"

type PlayboxAssetCandidate = {
  id: string
  collectionId: string
  kind: PlayboxAssetKind
  url: string
  remoteUrlBase: string
  remoteUrlExpiresAt: string | null
  downloadable: boolean
}

const PLAYBOX_PROVIDER = "playbox"
const DOWNLOADABLE_ASSET_KINDS = new Set<PlayboxAssetKind>(["output-video", "compressed-video", "poster", "output-image", "audio"])
const PRIMARY_ASSET_KINDS = new Set<PlayboxAssetKind>(["output-video", "output-image"])

export async function startPlayboxSync(): Promise<void> {
  resetSyncState({
    mode: "playbox-sync",
    message: "Starting Playbox sync...",
  })

  const catalog = await loadCatalog()
  const itemById = new Map(catalog.items.map((item) => [item.id, item]))
  const downloadedJobIds = new Set(catalog.downloadedJobIds || [])
  let reachedEnd = false

  for (let page = 1; page <= PLAYBOX_PAGE_LIMIT; page += 1) {
    if (shouldStopForCancellation()) {
      break
    }

    syncState.currentPage = page
    syncState.message = `Fetching Playbox page ${page}...`
    const response = await fetchPlayboxCollectionsPage(page)

    if (response.data.length === 0) {
      reachedEnd = true
      break
    }

    for (const collection of response.data) {
      if (shouldStopForCancellation()) {
        break
      }

      syncState.scanned += 1
      const record = toPlayboxCollectionRecord(collection)
      savePlayboxCollection(record)
      const assets = collectPlayboxAssets(collection)
      const primaryAsset = assets.find((asset) => PRIMARY_ASSET_KINDS.has(asset.kind)) || null
      const catalogItem = toPlayboxCatalogItem(collection, primaryAsset, itemById.get(playboxCatalogItemId(collection._id)))

      itemById.set(catalogItem.id, catalogItem)

      for (const asset of assets) {
        const existingAsset = findPlayboxAsset(asset.id)
        savePlayboxAsset(assetCandidateToRecord(asset, existingAsset))

        if (!asset.downloadable) {
          continue
        }

        if (existingAsset?.localFile) {
          syncState.skipped += 1
          if (primaryAsset?.id === asset.id) {
            applyPrimaryAssetToCatalogItem(catalogItem, existingAsset)
          }
          if (asset.kind === "poster") {
            applyPosterAssetToCatalogItem(catalogItem, existingAsset)
          }
          continue
        }

        try {
          syncState.message = `Downloading Playbox ${asset.kind} for ${collection.name || collection._id}...`
          const downloadedAsset = await downloadPlayboxAsset(collection, asset)
          savePlayboxAsset(downloadedAsset)
          syncState.downloaded += 1

          if (primaryAsset?.id === asset.id) {
            applyPrimaryAssetToCatalogItem(catalogItem, downloadedAsset)
          }
          if (asset.kind === "poster") {
            applyPosterAssetToCatalogItem(catalogItem, downloadedAsset)
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          syncState.errors.push({ id: asset.id, message })
          savePlayboxAsset({
            ...assetCandidateToRecord(asset, existingAsset),
            downloadError: message,
          })

          if (primaryAsset?.id === asset.id) {
            catalogItem.downloadError = message
          }
        }

        await savePlayboxCatalogProjection(catalog, itemById, downloadedJobIds)
        await sleep(SYNC_DELAY_MS)
      }

      await savePlayboxCatalogProjection(catalog, itemById, downloadedJobIds)
    }

    if (response.maxReached) {
      reachedEnd = true
      break
    }
  }

  const cancelled = Boolean(syncState.cancelRequested)
  const finishedAt = new Date().toISOString()

  if (!cancelled && !reachedEnd && syncState.currentPage >= PLAYBOX_PAGE_LIMIT) {
    syncState.errors.push({
      message: `Stopped after Playbox page limit ${PLAYBOX_PAGE_LIMIT}; increase PLAYBOX_PAGE_LIMIT if needed.`,
    })
  }

  catalog.lastRun = {
    mode: syncState.mode,
    provider: PLAYBOX_PROVIDER,
    scanned: syncState.scanned,
    downloaded: syncState.downloaded,
    skipped: syncState.skipped,
    errors: syncState.errors,
    cancelled,
    reachedEnd,
    finishedAt,
  }
  await savePlayboxCatalogProjection(catalog, itemById, downloadedJobIds)

  finishSyncRun({
    cancelled,
    finishedAt,
    completeMessage: syncState.errors.length
      ? `Finished Playbox sync with ${syncState.errors.length} error${syncState.errors.length === 1 ? "" : "s"}.`
      : `Finished Playbox sync. Downloaded ${syncState.downloaded} file${syncState.downloaded === 1 ? "" : "s"}.`,
  })
}

export function collectPlayboxAssets(collection: PlayboxCollection): PlayboxAssetCandidate[] {
  const assets: PlayboxAssetCandidate[] = []
  const seen = new Set<string>()

  addAsset(assets, seen, collection._id, "output-video", collection.output?.video?.url)
  addAsset(assets, seen, collection._id, "compressed-video", collection.output?.video?.compressedUrl)
  addAsset(assets, seen, collection._id, "poster", collection.output?.video?.posterUrl)
  addAsset(assets, seen, collection._id, "output-image", collection.output?.image?.url)
  addAsset(assets, seen, collection._id, "audio", collection.midProcessMedia?.audio?.url)
  addAsset(assets, seen, collection._id, "input-image", collection.input?.image?.url, false)
  addAsset(assets, seen, collection._id, "resized-input-image", collection.input?.image?.resizedImage?.url, false)
  addAsset(assets, seen, collection._id, "input-video", collection.input?.video?.url, false)

  return assets
}

function addAsset(
  assets: PlayboxAssetCandidate[],
  seen: Set<string>,
  collectionId: string,
  kind: PlayboxAssetKind,
  url: unknown,
  downloadable = DOWNLOADABLE_ASSET_KINDS.has(kind),
): void {
  if (typeof url !== "string" || !url.trim()) {
    return
  }

  const remoteUrlBase = stripUrlQuery(url)
  const dedupeKey = `${kind}:${remoteUrlBase}`
  if (seen.has(dedupeKey)) {
    return
  }
  seen.add(dedupeKey)

  assets.push({
    id: playboxAssetId(collectionId, kind, remoteUrlBase),
    collectionId,
    kind,
    url,
    remoteUrlBase,
    remoteUrlExpiresAt: signedUrlExpiresAt(url),
    downloadable,
  })
}

async function downloadPlayboxAsset(collection: PlayboxCollection, asset: PlayboxAssetCandidate): Promise<PlayboxAssetRecord> {
  const response = await fetch(asset.url, {
    headers: {
      accept: "*/*",
      referer: "https://www.playbox.com/",
    },
  })

  if (!response.ok) {
    throw new Error(`Playbox media download failed: ${response.status} ${response.statusText}`)
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  const filename = buildPlayboxFilename(collection, asset, getExtension(asset.remoteUrlBase))
  const localPath = path.join(MEDIA_DIR, filename)
  await mkdir(path.dirname(localPath), { recursive: true })
  const tempPath = `${localPath}.tmp`
  await writeFile(tempPath, bytes)
  await rename(tempPath, localPath)

  return {
    ...assetCandidateToRecord(asset, null),
    contentType: response.headers.get("content-type") || contentTypeFor(filename),
    localFile: filename,
    size: bytes.byteLength,
    sha256: hashBuffer(bytes),
    downloadedAt: new Date().toISOString(),
    downloadError: null,
  }
}

function toPlayboxCollectionRecord(collection: PlayboxCollection): PlayboxCollectionRecord {
  return {
    id: collection._id,
    accountId: stringOrNull(collection.user),
    name: stringOrNull(collection.name),
    status: stringOrNull(collection.status),
    modelId: stringOrNull(collection.model),
    modelName: stringOrNull(collection.modelName),
    modelType: stringOrNull(collection.modelType),
    outputType: stringOrNull(collection.output?.type),
    createdAt: stringOrNull(collection.createdAt),
    updatedAt: stringOrNull(collection.updatedAt),
    collection: sanitizeCollection(collection),
  }
}

function toPlayboxCatalogItem(
  collection: PlayboxCollection,
  primaryAsset: PlayboxAssetCandidate | null,
  existing: Partial<CatalogItem> = {},
): CatalogItem {
  const id = playboxCatalogItemId(collection._id)
  const createdAtIso = stringOrNull(collection.createdAt)
  const createdAt = createdAtIso ? Date.parse(createdAtIso) : null
  const prompt = stringOrNull(collection.customPrompt) || stringOrNull(collection.prompt) || stringOrNull(collection.name) || ""
  const mediaType = String(collection.output?.type || primaryAsset?.kind || "")
    .toLowerCase()
    .includes("image")
    ? "image"
    : "video"

  return {
    ...existing,
    id,
    provider: PLAYBOX_PROVIDER,
    collectionId: collection._id,
    assetId: primaryAsset?.id || existing.assetId || null,
    assetKind: primaryAsset?.kind || existing.assetKind || null,
    userId: stringOrNull(collection.user),
    type: mediaType,
    prompt,
    negativePrompt: stringOrNull(collection.negativePrompt) || "",
    status: normalizePlayboxStatus(collection.status),
    outputUrl: primaryAsset?.url || existing.outputUrl || null,
    inputUrl: stringOrNull(collection.input?.image?.url) || stringOrNull(collection.input?.video?.url) || existing.inputUrl || null,
    duration: numberOrNull(collection.output?.videoDuration) || existing.duration || null,
    createdAt: createdAt && Number.isFinite(createdAt) ? createdAt : existing.createdAt || null,
    createdAtIso,
    modelId: stringOrNull(collection.model) || existing.modelId || null,
    shared: Boolean(collection.isPublic),
    favorited: Boolean(collection.isPinned),
    error: null,
    updatedAt: stringOrNull(collection.updatedAt) || new Date().toISOString(),
    rawCollection: sanitizeCollection(collection),
  }
}

function applyPrimaryAssetToCatalogItem(item: CatalogItem, asset: PlayboxAssetRecord): void {
  item.localFile = asset.localFile
  item.size = asset.size
  item.fileSize = asset.size
  item.sha256 = asset.sha256
  item.verifiedAt = asset.downloadedAt
  item.contentType = asset.contentType
  item.downloadedAt = asset.downloadedAt
  item.downloadError = asset.downloadError
  item.outputUrl = asset.remoteUrlBase
}

function applyPosterAssetToCatalogItem(item: CatalogItem, asset: PlayboxAssetRecord): void {
  if (!asset.localFile) {
    return
  }

  item.thumbnailFile = asset.localFile
  item.thumbnailGeneratedAt = asset.downloadedAt
  item.thumbnailError = asset.downloadError
}

async function savePlayboxCatalogProjection(
  catalog: Awaited<ReturnType<typeof loadCatalog>>,
  itemById: Map<string, CatalogItem>,
  downloadedJobIds: Set<string>,
): Promise<void> {
  for (const item of itemById.values()) {
    if (item.provider !== PLAYBOX_PROVIDER || !item.localFile?.toLowerCase().endsWith(".mp4")) {
      continue
    }

    if (item.thumbnailFile) {
      continue
    }

    const thumbnail = await ensureCatalogThumbnail(item.localFile)
    if (thumbnail.thumbnailFile || thumbnail.thumbnailError) {
      item.thumbnailFile = thumbnail.thumbnailFile ?? item.thumbnailFile ?? null
      item.thumbnailGeneratedAt = thumbnail.thumbnailGeneratedAt ?? item.thumbnailGeneratedAt ?? null
      item.thumbnailError = thumbnail.thumbnailError ?? null
    }
  }

  for (const item of itemById.values()) {
    if (item.provider === PLAYBOX_PROVIDER && item.localFile) {
      downloadedJobIds.add(item.id)
    }
  }

  catalog.items = sortItems(Array.from(itemById.values()).map(publicSafeCatalogItem))
  catalog.downloadedJobIds = Array.from(downloadedJobIds).slice(-10000)
  catalog.updatedAt = new Date().toISOString()
  await saveCatalog(catalog)
}

function publicSafeCatalogItem(item: CatalogItem): CatalogItem {
  return {
    ...item,
    outputUrl: redactSignedUrl(item.outputUrl),
    inputUrl: redactSignedUrl(item.inputUrl),
    sourceUrl: redactSignedUrl(item.sourceUrl),
  }
}

function assetCandidateToRecord(asset: PlayboxAssetCandidate, existing: PlayboxAssetRecord | null): PlayboxAssetRecord {
  return {
    id: asset.id,
    collectionId: asset.collectionId,
    kind: asset.kind,
    remoteUrlBase: asset.remoteUrlBase,
    remoteUrlExpiresAt: asset.remoteUrlExpiresAt,
    contentType: existing?.contentType || contentTypeFor(asset.remoteUrlBase),
    localFile: existing?.localFile || null,
    size: existing?.size || null,
    sha256: existing?.sha256 || null,
    downloadedAt: existing?.downloadedAt || null,
    downloadError: existing?.downloadError || null,
  }
}

function sanitizeCollection(collection: PlayboxCollection): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(collection)) as unknown
  return recordOrNull(sanitizeSignedUrls(clone)) || {}
}

function sanitizeSignedUrls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeSignedUrls)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeSignedUrls(entry)]))
  }

  return typeof value === "string" ? redactSignedUrl(value) : value
}

function redactSignedUrl(value: string | null | undefined): string | null | undefined {
  if (!value || !/^https?:\/\//i.test(value)) {
    return value
  }

  try {
    const url = new URL(value)
    url.searchParams.delete("token")
    return url.toString()
  } catch {
    return value.replace(/([?&]token=)[^&]+/i, "$1[redacted]")
  }
}

function stripUrlQuery(value: string): string {
  try {
    const url = new URL(value)
    url.search = ""
    url.hash = ""
    return url.toString()
  } catch {
    return value.replace(/[?#].*$/, "")
  }
}

function signedUrlExpiresAt(value: string): string | null {
  try {
    const expires = Number(new URL(value).searchParams.get("expires"))
    return Number.isFinite(expires) && expires > 0 ? new Date(expires * 1000).toISOString() : null
  } catch {
    return null
  }
}

function playboxCatalogItemId(collectionId: string): string {
  return `playbox-${collectionId}`
}

function playboxAssetId(collectionId: string, kind: string, remoteUrlBase: string): string {
  const hash = createHash("sha256").update(`${collectionId}:${kind}:${remoteUrlBase}`).digest("hex").slice(0, 24)
  return `playbox-${hash}`
}

function buildPlayboxFilename(collection: PlayboxCollection, asset: PlayboxAssetCandidate, extension: string): string {
  const date = collection.createdAt ? collection.createdAt.slice(0, 10) : "undated"
  const id = sanitizePathPart(collection._id)
  const kind = sanitizePathPart(asset.kind)
  return `playbox/${date}/${date}_${kind}_${id}.${extension || "bin"}`
}

function getExtension(url: string): string {
  try {
    const match = new URL(url).pathname.match(/\.([a-z0-9]+)$/i)
    return match?.[1]?.toLowerCase() || "bin"
  } catch {
    const match = url.match(/\.([a-z0-9]+)$/i)
    return match?.[1]?.toLowerCase() || "bin"
  }
}

function normalizePlayboxStatus(value: unknown): string {
  const status = String(value || "").trim()
  if (status === "COMPLETED") return "done"
  if (status === "FAILED") return "failed"
  if (status) return status.toLowerCase()
  return "unknown"
}

function numberOrNull(value: unknown): number | null {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function toPublicPlayboxCatalogItem(collection: PlayboxCollection): ReturnType<typeof toPublicCatalogItem> {
  return toPublicCatalogItem(toPlayboxCatalogItem(collection, collectPlayboxAssets(collection)[0] || null))
}
