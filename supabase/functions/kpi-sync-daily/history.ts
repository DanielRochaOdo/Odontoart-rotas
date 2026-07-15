type SnapshotRow = {
  codigo: string | null;
  vidas_qtde: number | null;
  snapshot_at: string;
  sync_run_id: string | null;
};

export const buildPreviousByCodeMap = (
  rows: SnapshotRow[],
  currentSyncRunId: string,
) => {
  const previousByCode = new Map<string, number>();

  for (const item of rows) {
    if (!item.sync_run_id || item.sync_run_id === currentSyncRunId) continue;
    const codigo = String(item.codigo ?? "").trim();
    if (!codigo || previousByCode.has(codigo)) continue;
    const vidasQtde = Number(item.vidas_qtde);
    if (!Number.isFinite(vidasQtde)) continue;
    previousByCode.set(codigo, vidasQtde);
  }

  return previousByCode;
};
