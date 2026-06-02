import path from "node:path"
import { fileURLToPath } from "node:url"

import { getThumbnailDir } from "../thumbnails.ts"
import { parseBooleanEnv, resolveMediaDirFromRoot } from "./utils.ts"

export const SERVER_ENTRY_FILE = fileURLToPath(new URL("../server.ts", import.meta.url))
export const SRC_DIR = path.dirname(SERVER_ENTRY_FILE)
export const ROOT_DIR = path.resolve(SRC_DIR, "..")
try {
  process.loadEnvFile(path.join(ROOT_DIR, ".env"))
} catch {
  // A .env file is optional.
}

export let PORT: number
export let VITE_PORT: number
export let LOCAL_APP_URL: string | null
export let API_BASE_URL: string
export let APP_LOGIN_URL: string
export let PLAYBOX_API_BASE_URL: string
export let PLAYBOX_AUTH_BASE_URL: string
export let PLAYBOX_APP_URL: string
export let PLAYBOX_PAGE_LIMIT: number
export let PLAYBOX_CHROME_PATH: string | null
export let PLAYBOX_AUTH_IMPORT_PATH: string
export let PAGE_LIMIT: number
export let CREATE_HISTORY_PAGE_LIMIT: number
export let MEDIA_DIR: string
export let CATALOG_DB_PATH: string
export let BACKUP_DIR: string
export let THUMBNAIL_DIR: string
export let AUTH_BROWSER_PROFILE_DIR: string
export let PLAYBOX_AUTH_BROWSER_PROFILE_DIR: string
export let PUBLIC_DIR: string
export let SYNC_DELAY_MS: number
export let AUTH_BROWSER_REFRESH_MS: number
export let AUTO_SYNC_ENABLED: boolean
export let AUTO_SYNC_INTERVAL_MS: number
export let AUTO_SYNC_STARTUP_DELAY_MS: number
export let BACKGROUND_WORKERS_ENABLED: boolean
export let BACKGROUND_THUMBNAIL_ENABLED: boolean
export let BACKGROUND_THUMBNAIL_INTERVAL_MS: number
export let BACKGROUND_THUMBNAIL_STARTUP_DELAY_MS: number
export let BACKGROUND_THUMBNAIL_BATCH_SIZE: number
export let REDIRECT_STATIC_TO_VITE: boolean
export const AUTH_SETUP_MESSAGE = "Open More > Auth browser > Connect account, complete login in the visible browser window, then retry."

export function reloadConfigFromEnv(): void {
  PORT = Number(process.env["PORT"] || 6177)
  VITE_PORT = Number(process.env["VITE_PORT"] || 6173)
  LOCAL_APP_URL = process.env["LOCAL_APP_URL"] || null
  API_BASE_URL = process.env["GENERATEPORN_API_URL"] || "https://api.generateporn.ai/api/jobs"
  APP_LOGIN_URL = process.env["GENERATEPORN_APP_URL"] || "https://app.generateporn.ai/"
  PLAYBOX_API_BASE_URL = process.env["PLAYBOX_API_URL"] || "https://api.playbox.com/api"
  PLAYBOX_AUTH_BASE_URL = process.env["PLAYBOX_AUTH_URL"] || "https://api.playbox.com/auth"
  PLAYBOX_APP_URL = process.env["PLAYBOX_APP_URL"] || "https://www.playbox.com/collection"
  PLAYBOX_CHROME_PATH = process.env["PLAYBOX_CHROME_PATH"] || null
  PAGE_LIMIT = Number(process.env["GENERATEPORN_PAGE_LIMIT"] || 1000)
  PLAYBOX_PAGE_LIMIT = Number(process.env["PLAYBOX_PAGE_LIMIT"] || PAGE_LIMIT)
  CREATE_HISTORY_PAGE_LIMIT = Number(process.env["GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT"] || 20)
  MEDIA_DIR = resolveMediaDirFromRoot(ROOT_DIR, process.env["MEDIA_DIR"] || "media")
  CATALOG_DB_PATH = path.join(MEDIA_DIR, "catalog.sqlite")
  BACKUP_DIR = path.join(MEDIA_DIR, "_catalog_backups")
  THUMBNAIL_DIR = getThumbnailDir(MEDIA_DIR)
  AUTH_BROWSER_PROFILE_DIR = path.resolve(process.env["AUTH_BROWSER_PROFILE_DIR"] || path.join(MEDIA_DIR, "_auth_browser_profile"))
  PLAYBOX_AUTH_BROWSER_PROFILE_DIR = path.resolve(
    process.env["PLAYBOX_AUTH_BROWSER_PROFILE_DIR"] || path.join(MEDIA_DIR, "_playbox_auth_browser_profile"),
  )
  PLAYBOX_AUTH_IMPORT_PATH = path.resolve(process.env["PLAYBOX_AUTH_IMPORT_PATH"] || path.join(MEDIA_DIR, "_playbox_auth_session.json"))
  PUBLIC_DIR = path.join(ROOT_DIR, "public")
  SYNC_DELAY_MS = Number(process.env["SYNC_DELAY_MS"] || 150)
  AUTH_BROWSER_REFRESH_MS = Number(process.env["AUTH_BROWSER_REFRESH_MS"] || 15 * 60 * 1000)
  AUTO_SYNC_ENABLED = parseBooleanEnv(process.env["AUTO_SYNC_ENABLED"], true)
  AUTO_SYNC_INTERVAL_MS = Number(process.env["AUTO_SYNC_INTERVAL_MS"] || 60 * 60 * 1000)
  AUTO_SYNC_STARTUP_DELAY_MS = Number(process.env["AUTO_SYNC_STARTUP_DELAY_MS"] || 10 * 1000)
  BACKGROUND_WORKERS_ENABLED = parseBooleanEnv(process.env["BACKGROUND_WORKERS_ENABLED"], true)
  BACKGROUND_THUMBNAIL_ENABLED = parseBooleanEnv(process.env["BACKGROUND_THUMBNAIL_ENABLED"], true)
  BACKGROUND_THUMBNAIL_INTERVAL_MS = Number(process.env["BACKGROUND_THUMBNAIL_INTERVAL_MS"] || 30 * 60 * 1000)
  BACKGROUND_THUMBNAIL_STARTUP_DELAY_MS = Number(process.env["BACKGROUND_THUMBNAIL_STARTUP_DELAY_MS"] || 30 * 1000)
  BACKGROUND_THUMBNAIL_BATCH_SIZE = Number(process.env["BACKGROUND_THUMBNAIL_BATCH_SIZE"] || 25)
  REDIRECT_STATIC_TO_VITE = parseBooleanEnv(process.env["REDIRECT_STATIC_TO_VITE"], true)
}

reloadConfigFromEnv()
