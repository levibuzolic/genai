type BackgroundJobResult = Record<string, unknown> | void

type BackgroundJobDefinition = {
  id: string
  label: string
  enabled?: boolean
  intervalMs?: number
  startupDelayMs?: number
  handler: (context: { id: string; reason: string }) => Promise<BackgroundJobResult> | BackgroundJobResult
}

type BackgroundJobState = {
  id: string
  label: string
  enabled: boolean
  running: boolean
  intervalMs: number | null
  startupDelayMs: number
  nextRunAt: string | null
  lastRunAt: string | null
  lastFinishedAt: string | null
  lastError: string | null
  lastReason: string | null
  lastResult: Record<string, unknown> | null
  runCount: number
  skippedCount: number
  timerActive: boolean
}

type NormalizedBackgroundJobDefinition = Omit<BackgroundJobDefinition, "enabled" | "intervalMs" | "startupDelayMs"> & {
  enabled: boolean
  intervalMs: number | null
  startupDelayMs: number
}

type RegisteredBackgroundJob = {
  definition: NormalizedBackgroundJobDefinition
  state: BackgroundJobState
  timer: NodeJS.Timeout | null
}

const jobs = new Map<string, RegisteredBackgroundJob>()

export function registerBackgroundJob(definition: BackgroundJobDefinition): BackgroundJobState {
  const intervalMs = positiveNumberOrNull(definition.intervalMs)
  const startupDelayMs = Math.max(0, Number(definition.startupDelayMs || 0))
  const enabled = definition.enabled !== false
  clearBackgroundJob(definition.id)

  const state: BackgroundJobState = {
    id: definition.id,
    label: definition.label,
    enabled,
    running: false,
    intervalMs,
    startupDelayMs,
    nextRunAt: null,
    lastRunAt: null,
    lastFinishedAt: null,
    lastError: null,
    lastReason: null,
    lastResult: null,
    runCount: 0,
    skippedCount: 0,
    timerActive: false,
  }

  jobs.set(definition.id, {
    definition: {
      ...definition,
      enabled,
      startupDelayMs,
      intervalMs,
    },
    state,
    timer: null,
  })

  return { ...state }
}

export function startBackgroundWorkers(): Record<string, BackgroundJobState> {
  for (const job of jobs.values()) {
    if (!job.definition.enabled) continue
    scheduleRegisteredJob(job, job.definition.startupDelayMs, "startup")
  }

  return getBackgroundWorkerStatus()
}

export function stopBackgroundWorkers(): void {
  for (const job of jobs.values()) {
    clearRegisteredTimer(job)
    job.state.running = false
    job.state.nextRunAt = null
  }
}

export function resetBackgroundWorkers(): void {
  stopBackgroundWorkers()
  jobs.clear()
}

export function scheduleBackgroundJob(id: string, delayMs = 0, reason = "scheduled"): boolean {
  const job = jobs.get(id)
  if (!job || !job.definition.enabled) {
    return false
  }

  scheduleRegisteredJob(job, delayMs, reason)
  return true
}

export async function triggerBackgroundJob(id: string, reason = "manual"): Promise<Record<string, unknown>> {
  const job = jobs.get(id)
  if (!job) {
    return { started: false, reason: "unknown-job" }
  }

  if (!job.definition.enabled) {
    job.state.skippedCount += 1
    return { started: false, reason: "disabled" }
  }

  if (job.state.running) {
    job.state.skippedCount += 1
    return { started: false, reason: "already-running" }
  }

  clearRegisteredTimer(job)
  job.state.running = true
  job.state.lastRunAt = new Date().toISOString()
  job.state.lastReason = reason
  job.state.lastError = null
  job.state.runCount += 1

  try {
    const result = await job.definition.handler({ id: job.definition.id, reason })
    job.state.lastResult = normalizeJobResult(result)
    return { started: true, result: job.state.lastResult }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    job.state.lastError = message
    return { started: false, reason: "error", error: message }
  } finally {
    job.state.running = false
    job.state.lastFinishedAt = new Date().toISOString()
    if (job.definition.intervalMs && job.definition.enabled) {
      scheduleRegisteredJob(job, job.definition.intervalMs, "interval")
    }
  }
}

export function getBackgroundWorkerStatus(): Record<string, BackgroundJobState> {
  return Object.fromEntries([...jobs.values()].map((job) => [job.definition.id, { ...job.state, timerActive: Boolean(job.timer) }]))
}

function scheduleRegisteredJob(job: RegisteredBackgroundJob, delayMs: number, reason: string): void {
  clearRegisteredTimer(job)
  const delay = Math.max(0, Number(delayMs) || 0)
  job.state.nextRunAt = new Date(Date.now() + delay).toISOString()
  job.state.lastReason = reason
  job.timer = setTimeout(() => {
    job.timer = null
    job.state.timerActive = false
    void triggerBackgroundJob(job.definition.id, reason)
  }, delay)
  job.state.timerActive = true
  job.timer.unref?.()
}

function clearBackgroundJob(id: string): void {
  const existing = jobs.get(id)
  if (!existing) {
    return
  }

  clearRegisteredTimer(existing)
  jobs.delete(id)
}

function clearRegisteredTimer(job: RegisteredBackgroundJob): void {
  if (!job.timer) {
    job.state.timerActive = false
    return
  }

  clearTimeout(job.timer)
  job.timer = null
  job.state.timerActive = false
  job.state.nextRunAt = null
}

function normalizeJobResult(result: BackgroundJobResult): Record<string, unknown> | null {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return null
  }

  return result
}

function positiveNumberOrNull(value: unknown): number | null {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}
