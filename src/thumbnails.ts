import { execFile } from "node:child_process"
import { mkdir, rename, stat, unlink } from "node:fs/promises"
import path from "node:path"

const THUMBNAIL_SUBDIR = "_thumbnails"

type ProcessResult = {
  stdout: string | Buffer
  stderr: string | Buffer
}

type ProcessRunner = (command: string, args: readonly string[]) => Promise<ProcessResult | void>

type ThumbnailOptions = {
  ffmpegPath?: string
  runProcess?: ProcessRunner
}

type ThumbnailResult = {
  skipped?: boolean
  reason?: "not-video"
  thumbnailFile?: string | null
  created?: boolean
  generatedAt?: string
  error?: string
}

type NodeProcessError = Error & {
  code?: string
  stdout?: string | Buffer
  stderr?: string | Buffer
}

let processRunnerOverride: ProcessRunner | null = null

async function ensureVideoThumbnail(mediaDir: string, localFile: string, options: ThumbnailOptions = {}): Promise<ThumbnailResult> {
  if (!isMp4(localFile)) {
    return { skipped: true, reason: "not-video" }
  }

  const sourcePath = resolveInside(mediaDir, localFile)
  const thumbnailFile = getThumbnailRelativePath(localFile)
  const thumbnailPath = resolveInside(mediaDir, thumbnailFile)

  if (await existingFile(thumbnailPath)) {
    return {
      thumbnailFile,
      created: false,
    }
  }

  await mkdir(path.dirname(thumbnailPath), { recursive: true })

  const ffmpegPath = options.ffmpegPath || getDefaultFfmpegPath()
  const runProcess = options.runProcess || processRunnerOverride || runProcessCommand
  const tempPath = `${thumbnailPath}.${process.pid}.${Date.now()}.tmp.jpg`
  const attempts = [
    ["-y", "-hide_banner", "-loglevel", "error", "-ss", "00:00:01", "-i", sourcePath, "-frames:v", "1", "-q:v", "4", tempPath],
    ["-y", "-hide_banner", "-loglevel", "error", "-i", sourcePath, "-frames:v", "1", "-q:v", "4", tempPath],
  ]

  try {
    let lastError: unknown = null

    for (const args of attempts) {
      try {
        await runProcess(ffmpegPath, args)

        if (await existingFile(tempPath)) {
          await rename(tempPath, thumbnailPath)
          return {
            thumbnailFile,
            created: true,
            generatedAt: new Date().toISOString(),
          }
        }

        lastError = new Error("ffmpeg did not write a thumbnail")
      } catch (error) {
        lastError = error

        if (isMissingExecutableError(error)) {
          break
        }
      } finally {
        await removeIfExists(tempPath)
      }
    }

    return {
      thumbnailFile: null,
      created: false,
      error: formatThumbnailError(lastError, ffmpegPath),
    }
  } catch (error) {
    await removeIfExists(tempPath)
    return {
      thumbnailFile: null,
      created: false,
      error: formatThumbnailError(error, ffmpegPath),
    }
  }
}

function getThumbnailRelativePath(localFile: string): string {
  const normalized = toPosixPath(localFile)
  const parsed = path.posix.parse(normalized)
  return path.posix.join(THUMBNAIL_SUBDIR, parsed.dir, `${parsed.name}.jpg`)
}

function getThumbnailDir(mediaDir: string): string {
  return path.join(mediaDir, THUMBNAIL_SUBDIR)
}

function setThumbnailProcessRunnerForTests(runProcess: ProcessRunner | null): () => void {
  const previous = processRunnerOverride
  processRunnerOverride = runProcess

  return () => {
    processRunnerOverride = previous
  }
}

function getDefaultFfmpegPath(): string {
  return process.env["FFMPEG_PATH"] || "ffmpeg"
}

function runProcessCommand(command: string, args: readonly string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
        return
      }

      resolve({ stdout, stderr })
    })
  })
}

async function existingFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile() && fileStat.size > 0
  } catch {
    return false
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch {
    // Best-effort cleanup for failed thumbnail attempts.
  }
}

function resolveInside(rootDir: string, relativePath: string): string {
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, relativePath)
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`

  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new Error(`Path escapes media directory: ${relativePath}`)
  }

  return resolved
}

function isMp4(value: unknown): value is string {
  return typeof value === "string" && value.toLowerCase().endsWith(".mp4")
}

function isMissingExecutableError(error: unknown): error is NodeProcessError {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT")
}

function formatThumbnailError(error: unknown, ffmpegPath: string): string {
  if (isMissingExecutableError(error)) {
    return `${ffmpegPath} is not available on PATH`
  }

  const stderr = isNodeProcessErrorLike(error) ? String(error.stderr || "").trim() : ""
  const message = stderr || (error instanceof Error ? error.message : String(error))
  return (message.split(/\r?\n/)[0] ?? "").slice(0, 240)
}

function isNodeProcessErrorLike(error: unknown): error is Partial<NodeProcessError> {
  return Boolean(error && typeof error === "object")
}

function toPosixPath(value: unknown): string {
  return String(value || "")
    .split(path.sep)
    .join("/")
}

export { THUMBNAIL_SUBDIR, ensureVideoThumbnail, getThumbnailDir, getThumbnailRelativePath, setThumbnailProcessRunnerForTests }
