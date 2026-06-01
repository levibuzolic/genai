import http from "node:http"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

const SERVER_PATH = new URL("../../src/server.ts", import.meta.url)
export const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
)

export async function importServer(mediaDir, env = {}) {
  const previousEnv = {
    MEDIA_DIR: process.env.MEDIA_DIR,
    PORT: process.env.PORT,
    SYNC_DELAY_MS: process.env.SYNC_DELAY_MS,
    AUTO_SYNC_ENABLED: process.env.AUTO_SYNC_ENABLED,
    AUTO_SYNC_INTERVAL_MS: process.env.AUTO_SYNC_INTERVAL_MS,
    AUTO_SYNC_STARTUP_DELAY_MS: process.env.AUTO_SYNC_STARTUP_DELAY_MS,
    GENERATEPORN_AUTHORIZATION: process.env.GENERATEPORN_AUTHORIZATION,
    GENERATEPORN_COOKIE: process.env.GENERATEPORN_COOKIE,
    GENERATEPORN_PAGE_LIMIT: process.env.GENERATEPORN_PAGE_LIMIT,
    GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT: process.env.GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT,
    PLAYBOX_AUTHORIZATION: process.env.PLAYBOX_AUTHORIZATION,
    PLAYBOX_AUTH_IMPORT_PATH: process.env.PLAYBOX_AUTH_IMPORT_PATH,
    PLAYBOX_PAGE_LIMIT: process.env.PLAYBOX_PAGE_LIMIT,
    REDIRECT_STATIC_TO_VITE: process.env.REDIRECT_STATIC_TO_VITE,
    VITE_PORT: process.env.VITE_PORT,
  }

  process.env.MEDIA_DIR = mediaDir
  process.env.PORT = "0"
  process.env.SYNC_DELAY_MS = "0"
  process.env.AUTO_SYNC_ENABLED = env.AUTO_SYNC_ENABLED || "false"
  process.env.AUTO_SYNC_INTERVAL_MS = env.AUTO_SYNC_INTERVAL_MS || "3600000"
  process.env.AUTO_SYNC_STARTUP_DELAY_MS = env.AUTO_SYNC_STARTUP_DELAY_MS || "10000"
  process.env.GENERATEPORN_PAGE_LIMIT = "3"
  process.env.GENERATEPORN_CREATE_HISTORY_PAGE_LIMIT = "3"
  process.env.GENERATEPORN_AUTHORIZATION = env.GENERATEPORN_AUTHORIZATION || ""
  process.env.GENERATEPORN_COOKIE = env.GENERATEPORN_COOKIE || ""
  process.env.PLAYBOX_AUTHORIZATION = env.PLAYBOX_AUTHORIZATION || ""
  process.env.PLAYBOX_AUTH_IMPORT_PATH = env.PLAYBOX_AUTH_IMPORT_PATH || ""
  process.env.PLAYBOX_PAGE_LIMIT = env.PLAYBOX_PAGE_LIMIT || "3"
  process.env.REDIRECT_STATIC_TO_VITE = env.REDIRECT_STATIC_TO_VITE || "false"
  process.env.VITE_PORT = env.VITE_PORT || ""

  const imported = await import(`${SERVER_PATH.href}?test=${Date.now()}-${Math.random()}`)

  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  return imported
}

export async function writeCatalog(mediaDir, catalog) {
  const dbPath = path.join(mediaDir, "catalog.sqlite")
  const db = new DatabaseSync(dbPath)
  const normalized = {
    items: Array.isArray(catalog.items) ? catalog.items : [],
    downloadedJobIds: Array.isArray(catalog.downloadedJobIds) ? catalog.downloadedJobIds : [],
    orphanFiles: Array.isArray(catalog.orphanFiles) ? catalog.orphanFiles : [],
    lastSeenJobId: catalog.lastSeenJobId || null,
    updatedAt: catalog.updatedAt || null,
    lastRun: catalog.lastRun || null,
  }

  try {
    ensureTestCatalogSchema(db)
    db.exec("BEGIN IMMEDIATE")
    db.exec("DELETE FROM media_items")
    db.exec("DELETE FROM downloaded_job_ids")
    db.exec("DELETE FROM orphan_files")

    const insertItem = db.prepare("INSERT INTO media_items (id, item_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
    for (const item of normalized.items) {
      insertItem.run(item.id, JSON.stringify(item), Number(item.createdAt || 0), item.updatedAt || null)
    }

    const insertDownloaded = db.prepare("INSERT INTO downloaded_job_ids (id, position) VALUES (?, ?)")
    normalized.downloadedJobIds.forEach((id, index) => insertDownloaded.run(id, index))

    const insertOrphan = db.prepare("INSERT INTO orphan_files (local_file, file_json) VALUES (?, ?)")
    for (const file of normalized.orphanFiles) {
      if (file?.localFile) insertOrphan.run(file.localFile, JSON.stringify(file))
    }

    const upsertMeta = db.prepare(`
      INSERT INTO catalog_meta (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `)
    upsertMeta.run("lastSeenJobId", JSON.stringify(normalized.lastSeenJobId))
    upsertMeta.run("updatedAt", JSON.stringify(normalized.updatedAt))
    upsertMeta.run("lastRun", JSON.stringify(normalized.lastRun))
    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  } finally {
    db.close()
  }
}

export async function readCatalog(mediaDir) {
  return readCatalogFromDbFile(path.join(mediaDir, "catalog.sqlite"))
}

export async function readCatalogFromDbFile(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const metaRows = db.prepare("SELECT key, value_json FROM catalog_meta").all()
    const meta = new Map(metaRows.map((row) => [row.key, JSON.parse(row.value_json)]))

    return {
      items: db
        .prepare("SELECT item_json FROM media_items ORDER BY created_at DESC, id ASC")
        .all()
        .map((row) => JSON.parse(row.item_json)),
      downloadedJobIds: db
        .prepare("SELECT id FROM downloaded_job_ids ORDER BY position ASC")
        .all()
        .map((row) => row.id),
      orphanFiles: db
        .prepare("SELECT file_json FROM orphan_files ORDER BY local_file ASC")
        .all()
        .map((row) => JSON.parse(row.file_json)),
      lastSeenJobId: meta.get("lastSeenJobId") || null,
      updatedAt: meta.get("updatedAt") || null,
      lastRun: meta.get("lastRun") || null,
    }
  } finally {
    db.close()
  }
}

export function deferred() {
  let resolve
  let reject
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

export function listenOnRandomPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, () => {
      server.off("error", reject)
      resolve({
        port: server.address().port,
        close: () => closeServer(server),
      })
    })
  })
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}

export function postJson(port, pathname, body = {}) {
  return requestJson(port, pathname, "POST", body)
}

export function requestJson(port, pathname, method, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        const chunks = []

        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8")
          resolve({
            statusCode: response.statusCode,
            body: raw ? JSON.parse(raw) : null,
          })
        })
      },
    )

    request.on("error", reject)
    request.end(payload)
  })
}

export function requestRaw(port, pathname, headers = {}, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: pathname,
        method,
        headers,
      },
      (response) => {
        const chunks = []

        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          })
        })
      },
    )

    request.on("error", reject)
    request.end()
  })
}

export function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  })
}

export function fakeBearerToken(claims = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...claims,
    }),
  ).toString("base64url")

  return `Bearer ${header}.${payload}.signature`
}

export function imageDataUrl() {
  return `data:image/png;base64,${PNG_BYTES.toString("base64")}`
}

function ensureTestCatalogSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS catalog_meta (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      item_json TEXT NOT NULL,
      created_at INTEGER,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS media_items_created_at_idx ON media_items(created_at DESC);

    CREATE TABLE IF NOT EXISTS downloaded_job_ids (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orphan_files (
      local_file TEXT PRIMARY KEY,
      file_json TEXT NOT NULL
    );
  `)
}
