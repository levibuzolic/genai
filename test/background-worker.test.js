import assert from "node:assert/strict"
import test from "node:test"

import {
  getBackgroundWorkerStatus,
  registerBackgroundJob,
  resetBackgroundWorkers,
  triggerBackgroundJob,
} from "../src/server/background-worker.ts"

test("background worker registry tracks status and manual runs", async () => {
  resetBackgroundWorkers()
  const runs = []

  try {
    const initial = registerBackgroundJob({
      id: "example-worker",
      label: "Example worker",
      startupDelayMs: 25,
      handler: (context) => {
        runs.push(context)
        return { processed: runs.length }
      },
    })

    assert.equal(initial.enabled, true)
    assert.equal(initial.startupDelayMs, 25)
    assert.equal(initial.running, false)
    assert.equal(getBackgroundWorkerStatus()["example-worker"].runCount, 0)

    const result = await triggerBackgroundJob("example-worker", "manual-test")
    const status = getBackgroundWorkerStatus()["example-worker"]

    assert.deepEqual(result, { started: true, result: { processed: 1 } })
    assert.deepEqual(runs, [{ id: "example-worker", reason: "manual-test" }])
    assert.equal(status.runCount, 1)
    assert.equal(status.lastReason, "manual-test")
    assert.deepEqual(status.lastResult, { processed: 1 })
  } finally {
    resetBackgroundWorkers()
  }
})
