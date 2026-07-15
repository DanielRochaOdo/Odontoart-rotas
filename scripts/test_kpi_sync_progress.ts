import assert from "node:assert/strict";
import { resolveSyncCompletionState } from "../supabase/functions/kpi-sync-daily/progress.ts";
import { buildPreviousByCodeMap } from "../supabase/functions/kpi-sync-daily/history.ts";

const totalCodes = 2606;
const batchLimit = 10;
const processedCodes = 10;
const remainingCodes = totalCodes - batchLimit;

const result = resolveSyncCompletionState({
  totalCodes,
  processedCodes,
  remainingCodes,
  distinctProcessedCodes: processedCodes,
});

assert.equal(result.status, "running");
assert.equal(result.remaining_codes, 2596);
assert.equal(result.current_stage, "waiting_next_invocation");
assert.equal(result.finished_at, null);

const historyRows = Array.from({ length: 3206 }, (_, index) => ({
  codigo: String(index % 2606).padStart(4, "0"),
  vidas_qtde: index,
  snapshot_at: `2026-07-14T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
  sync_run_id: index >= 3000 ? "current-run" : `old-run-${index}`,
}));

const previousMap = buildPreviousByCodeMap(historyRows, "current-run");
assert.equal(previousMap.size, 2606);
assert.equal(previousMap.get("0000"), 0);
assert.equal(previousMap.get("2605"), 2605);

const cappedHistoryRows = Array.from({ length: 2800 }, (_, index) => ({
  codigo: index < 2606 ? String(index).padStart(4, "0") : "9999",
  vidas_qtde: index,
  snapshot_at: `2026-07-13T23:${String(index % 60).padStart(2, "0")}:00.000Z`,
  sync_run_id: index >= 2700 ? "current-run" : `old-run-${index}`,
}));
const cappedPreviousMap = buildPreviousByCodeMap(cappedHistoryRows, "current-run");
assert.equal(cappedPreviousMap.size, 2607);
const currentCodes = new Set(Array.from({ length: 2606 }, (_, index) => String(index).padStart(4, "0")));
const processedCurrentCodes = new Set(Array.from(cappedPreviousMap.keys()).filter((code) => currentCodes.has(code)));
assert.equal(processedCurrentCodes.size, 2606);
assert.equal(processedCurrentCodes.has("9999"), false);

const runningState = resolveSyncCompletionState({
  totalCodes: 2606,
  processedCodes: 10,
  remainingCodes: 2596,
  distinctProcessedCodes: 10,
});
assert.equal(runningState.status, "running");

const successBlockedByRemaining = resolveSyncCompletionState({
  totalCodes: 2606,
  processedCodes: 2606,
  remainingCodes: 1,
  distinctProcessedCodes: 2606,
});
assert.equal(successBlockedByRemaining.status, "running");

const successOnlyWithZeroRemaining = resolveSyncCompletionState({
  totalCodes: 2606,
  processedCodes: 2606,
  remainingCodes: 0,
  distinctProcessedCodes: 2606,
});
assert.equal(successOnlyWithZeroRemaining.status, "success");

console.log("OK: test_kpi_sync_progress");
