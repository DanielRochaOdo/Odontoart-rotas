import assert from "node:assert/strict";
import {
  DATA_CORTE_FILA,
  evaluateDataContratoForFila,
  parseDataContratoToIso,
} from "../src/lib/filaDataContrato";

const shouldAutoRegisterInQueue = (dataContratoFromApi: unknown, createdAt?: string) => {
  void createdAt;
  const evaluation = evaluateDataContratoForFila(dataContratoFromApi);
  return evaluation;
};

const run = () => {
  assert.equal(DATA_CORTE_FILA, "2026-01-01");

  // Cenario 1: 10/2018 => bloqueia por corte.
  assert.equal(parseDataContratoToIso("10/2018"), "2018-10-01");
  assert.equal(parseDataContratoToIso("2018/10/08"), "2018-10-08");
  {
    const result = evaluateDataContratoForFila("10/2018");
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DATA_CONTRATO_FORA_DO_CORTE");
    assert.equal(result.dataContratoIso, "2018-10-01");
  }
  {
    const result = evaluateDataContratoForFila("2018/10/08");
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DATA_CONTRATO_FORA_DO_CORTE");
    assert.equal(result.dataContratoIso, "2018-10-08");
  }

  // Cenario 2: 12/2025 => bloqueia por corte.
  assert.equal(parseDataContratoToIso("12/2025"), "2025-12-01");
  {
    const result = evaluateDataContratoForFila("12/2025");
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DATA_CONTRATO_FORA_DO_CORTE");
    assert.equal(result.dataContratoIso, "2025-12-01");
  }

  // Cenario 3: 01/2026 => elegivel.
  assert.equal(parseDataContratoToIso("01/2026"), "2026-01-01");
  {
    const result = evaluateDataContratoForFila("01/2026");
    assert.equal(result.eligible, true);
    assert.equal(result.reason, "DATA_CONTRATO_ELEGIVEL");
    assert.equal(result.dataContratoIso, "2026-01-01");
  }

  // Cenario 4: DD/MM/YYYY valido => elegivel.
  assert.equal(parseDataContratoToIso("15/01/2026"), "2026-01-15");
  {
    const result = evaluateDataContratoForFila("15/01/2026");
    assert.equal(result.eligible, true);
    assert.equal(result.reason, "DATA_CONTRATO_ELEGIVEL");
    assert.equal(result.dataContratoIso, "2026-01-15");
  }

  // Cenario 5: YYYY-MM-DD no corte => elegivel.
  assert.equal(parseDataContratoToIso("2026-01-01"), "2026-01-01");
  {
    const result = evaluateDataContratoForFila("2026-01-01");
    assert.equal(result.eligible, true);
    assert.equal(result.reason, "DATA_CONTRATO_ELEGIVEL");
    assert.equal(result.dataContratoIso, "2026-01-01");
  }

  // Cenario 6: null => bloqueia, sem fallback.
  {
    const result = evaluateDataContratoForFila(null);
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DATA_CONTRATO_INVALIDA_OU_AUSENTE");
    assert.equal(result.detailReason, "API_DATA_CONTRATO_NAO_RETORNADA");
  }

  // Cenario 7: formato invalido => bloqueia.
  {
    const result = evaluateDataContratoForFila("texto-aleatorio");
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DATA_CONTRATO_INVALIDA_OU_AUSENTE");
    assert.equal(result.detailReason, "API_DATA_CONTRATO_FORMATO_INVALIDO");
  }
  assert.equal(parseDataContratoToIso("31/02/2026"), null);

  // Cenario 8: created_at recente nao pode liberar contrato antigo.
  {
    const result = shouldAutoRegisterInQueue("10/2018", "2026-05-01T00:00:00.000Z");
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DATA_CONTRATO_FORA_DO_CORTE");
    assert.equal(result.dataContratoIso, "2018-10-01");
  }

  // Cenario 9: API sem DataContrato (undefined) => bloqueia.
  {
    const result = shouldAutoRegisterInQueue(undefined, "2026-05-01T00:00:00.000Z");
    assert.equal(result.eligible, false);
    assert.equal(result.reason, "DATA_CONTRATO_INVALIDA_OU_AUSENTE");
    assert.equal(result.detailReason, "API_DATA_CONTRATO_NAO_RETORNADA");
  }

  console.log("OK: test_fila_data_contrato (9 cenarios + validacoes extras)");
};

run();
