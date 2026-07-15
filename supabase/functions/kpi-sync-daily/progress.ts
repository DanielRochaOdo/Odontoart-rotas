export type SyncCompletionState = {
  status: "success" | "running";
  finished_at: string | null;
  current_stage: string | null;
  remaining_codes: number;
};

export const resolveSyncCompletionState = (params: {
  totalCodes: number;
  processedCodes: number;
  remainingCodes: number;
  distinctProcessedCodes: number;
}): SyncCompletionState => {
  if (params.remainingCodes === 0) {
    return {
      status: "success",
      finished_at: new Date().toISOString(),
      current_stage: null,
      remaining_codes: 0,
    };
  }

  return {
    status: "running",
    finished_at: null,
    current_stage: "waiting_next_invocation",
    remaining_codes: params.remainingCodes,
  };
};
