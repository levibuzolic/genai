import type { ServerResponse } from "node:http"

import { sendJsonText, stringifyJson } from "./static.ts"

type CacheEntry = {
  byteLength: number
  expiresAt: number
  json: string
  revision: number
  statusCode: number
}

const DEFAULT_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 200
const responseCache = new Map<string, CacheEntry>()

export function clearReadResponseCache(): void {
  responseCache.clear()
}

export async function sendCachedJson(
  response: ServerResponse,
  {
    key,
    revision,
    ttlMs = DEFAULT_TTL_MS,
  }: {
    key: string
    revision: number
    ttlMs?: number
  },
  producer: () => Promise<unknown> | unknown,
): Promise<void> {
  const now = Date.now()
  const existing = getReadResponseCacheEntry(key, revision, now)
  if (existing) {
    sendJsonText(response, existing.json, existing.statusCode, existing.byteLength)
    return
  }

  const entry = await buildReadResponseCacheEntry({ key, revision, ttlMs }, producer, now)
  sendJsonText(response, entry.json)
}

export async function warmCachedJson(
  {
    key,
    revision,
    ttlMs = DEFAULT_TTL_MS,
  }: {
    key: string
    revision: number
    ttlMs?: number
  },
  producer: () => Promise<unknown> | unknown,
): Promise<void> {
  const now = Date.now()
  if (getReadResponseCacheEntry(key, revision, now)) return

  await buildReadResponseCacheEntry({ key, revision, ttlMs }, producer, now)
}

function getReadResponseCacheEntry(key: string, revision: number, now: number): CacheEntry | null {
  const existing = responseCache.get(key)
  if (existing && existing.revision === revision && existing.expiresAt > now) {
    return existing
  }

  return null
}

async function buildReadResponseCacheEntry(
  {
    key,
    revision,
    ttlMs,
  }: {
    key: string
    revision: number
    ttlMs: number
  },
  producer: () => Promise<unknown> | unknown,
  now: number,
): Promise<CacheEntry> {
  const json = stringifyJson(await producer())
  const entry = {
    byteLength: Buffer.byteLength(json),
    expiresAt: now + ttlMs,
    json,
    revision,
    statusCode: 200,
  }

  responseCache.set(key, entry)
  pruneReadResponseCache()
  return entry
}

function pruneReadResponseCache(): void {
  if (responseCache.size <= MAX_CACHE_ENTRIES) return

  const now = Date.now()
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) {
      responseCache.delete(key)
    }
  }

  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = responseCache.keys().next().value
    if (!firstKey) return
    responseCache.delete(firstKey)
  }
}
