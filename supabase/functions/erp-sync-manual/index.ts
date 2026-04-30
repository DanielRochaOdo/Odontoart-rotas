import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ODONTOART_EMPRESA_URL = "https://odontoart.s4e.com.br/api/empresa/BuscaEmpresas";
const ODONTOART_TIMEOUT_MS = 12000;
const ODONTOART_MAX_ATTEMPTS = 3;
const MAX_CODES_PER_REQUEST = 1000;
const MAX_WAVE_LIMIT = 50;
const DEFAULT_WAVE_LIMIT = 20;
const UNLOCK_TTL_MINUTES = 30;
const MAX_CONCURRENCY = 2;

const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
const odontoartToken =
  Deno.env.get("ODONTOART_TOKEN")?.trim() ||
  Deno.env.get("VITE_ODONTOART_TOKEN")?.trim() ||
  "";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

type UnlockPayload = {
  release_password?: string;
};

type PreviewPayload = {
  unlock_token?: string;
  codes?: unknown;
};

type ExecuteWavePayload = {
  unlock_token?: string;
  codes?: unknown;
  offset?: number;
  limit?: number;
};

type SyncResult = {
  code: string;
  status:
    | "updated"
    | "no_changes"
    | "local_not_found"
    | "erp_not_found"
    | "no_mapped_fields"
    | "failed";
  updated_rows: number;
  changed_rows: number;
  fields: string[];
  changes: Array<{
    field: string;
    from_values: Array<string | number | null>;
    to_value: string | number | null;
    changed_rows: number;
  }>;
  message: string | null;
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const extractBearerToken = (authorizationHeader: string) => {
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const shouldRetryStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const resolveCallerUserId = async (token: string) => {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
};

const resolveCallerRole = async (userId: string) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return (data?.role as string | undefined) ?? null;
};

const appendManualLog = async (
  userId: string | null,
  action: string,
  status: "success" | "denied" | "error",
  details: Record<string, unknown>,
) => {
  try {
    await supabase.from("erp_sync_manual_logs").insert({
      user_id: userId,
      action,
      status,
      details,
    });
  } catch {
    // ignore logging errors
  }
};

const parseCodesFromUnknown = (input: unknown) => {
  const values: string[] = [];

  if (Array.isArray(input)) {
    input.forEach((item) => {
      if (typeof item !== "string") return;
      item
        .split(/[\n,;]+/g)
        .map((part) => part.trim())
        .filter(Boolean)
        .forEach((part) => values.push(part));
    });
  } else if (typeof input === "string") {
    input
      .split(/[\n,;]+/g)
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => values.push(part));
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    deduped.push(value);
  });

  if (deduped.length > MAX_CODES_PER_REQUEST) {
    throw new Error(`Limite excedido. Maximo permitido: ${MAX_CODES_PER_REQUEST} codigos por solicitacao.`);
  }

  return deduped;
};

const parseNumberFromUnknown = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\./g, "").replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeDigits = (value: string) => value.replace(/\D/g, "");
const NUMERIC_CLIENTE_FIELDS = new Set(["corte", "venc", "valor"]);

const normalizeCnpj = (value: string | null | undefined) => {
  const digits = sanitizeDigits(value ?? "").slice(0, 14);
  if (digits.length !== 14) return null;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
};

const normalizeCep = (value: string | null | undefined) => {
  const digits = sanitizeDigits(value ?? "").slice(0, 8);
  if (digits.length !== 8) return null;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};

const readRecordValueByKeyInsensitive = (record: Record<string, unknown>, key: string) => {
  if (key in record) return record[key];
  const target = key.toLowerCase();
  const foundKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === target);
  if (!foundKey) return undefined;
  return record[foundKey];
};

const readRecordValueByKeys = (record: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys) {
    const value = readRecordValueByKeyInsensitive(record, key);
    if (value !== undefined) return value;
  }
  return undefined;
};

const readStringByKeysFromUnknown = (value: unknown, keys: string[], depth = 0): string | null => {
  if (depth > 5 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readStringByKeysFromUnknown(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = readRecordValueByKeyInsensitive(record, key);
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return String(candidate);
    }
  }

  for (const nested of Object.values(record)) {
    const found = readStringByKeysFromUnknown(nested, keys, depth + 1);
    if (found) return found;
  }

  return null;
};

const resolveValorTitular = (empresa: Record<string, unknown>) => {
  const fromValue = parseNumberFromUnknown(empresa.ValorTitular);
  if (fromValue !== null) return fromValue;

  const precoPlano = empresa.PrecoPlano;
  if (!Array.isArray(precoPlano)) return null;

  for (const row of precoPlano) {
    if (!row || typeof row !== "object") continue;
    const value = parseNumberFromUnknown((row as Record<string, unknown>).ValorTitular);
    if (value !== null) return value;
  }

  return null;
};

const extractEmpresaFromPayload = (payload: unknown): Record<string, unknown> | null => {
  if (!payload || typeof payload !== "object") return null;

  const record = payload as Record<string, unknown>;
  const dados = record.dados;

  if (Array.isArray(dados) && dados.length > 0 && dados[0] && typeof dados[0] === "object") {
    return dados[0] as Record<string, unknown>;
  }

  if (Array.isArray(payload) && payload.length > 0 && payload[0] && typeof payload[0] === "object") {
    return payload[0] as Record<string, unknown>;
  }

  return null;
};

const buildCodigoCandidates = (rawCodigo: string) => {
  const trimmed = rawCodigo.trim();
  const isNumericCode = /^\d+$/.test(trimmed);
  return Array.from(
    new Set(
      [
        trimmed,
        isNumericCode ? trimmed.replace(/^0+/, "") : "",
        isNumericCode ? String(Number(trimmed)) : "",
      ].filter(Boolean),
    ),
  );
};

const fetchOdontoartPayload = async (codigo: string) => {
  if (!odontoartToken) {
    throw new Error("ODONTOART_TOKEN nao configurado na function.");
  }

  const candidates = buildCodigoCandidates(codigo);
  let lastPayload: unknown = null;

  for (const candidate of candidates) {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= ODONTOART_MAX_ATTEMPTS; attempt += 1) {
      const search = new URLSearchParams({ token: odontoartToken, empresaId: candidate });
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ODONTOART_TIMEOUT_MS);

      try {
        const response = await fetch(`${ODONTOART_EMPRESA_URL}?${search.toString()}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Cache-Control": "no-store",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const retriable = shouldRetryStatus(response.status);
          if (!retriable || attempt >= ODONTOART_MAX_ATTEMPTS) {
            throw new Error(`Falha ao consultar ERP (${response.status}).`);
          }
          await sleep(250 * attempt);
          continue;
        }

        const payload = (await response.json()) as unknown;
        lastPayload = payload;
        if (extractEmpresaFromPayload(payload)) return payload;
        break;
      } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        const transient =
          isAbort ||
          (error instanceof TypeError && /network|fetch|failed/i.test(error.message));

        lastError = isAbort
          ? new Error("Tempo limite excedido ao consultar ERP.")
          : error instanceof Error
            ? error
            : new Error("Erro de comunicacao com ERP.");

        if (!transient || attempt >= ODONTOART_MAX_ATTEMPTS) {
          throw lastError;
        }

        await sleep(250 * attempt);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (extractEmpresaFromPayload(lastPayload)) return lastPayload;
  }

  return lastPayload;
};

const buildClienteUpdatePayload = (empresa: Record<string, unknown>, payload: unknown) => {
  const updates: Record<string, string | number | null> = {};

  const cnpj =
    normalizeCnpj(String(readRecordValueByKeys(empresa, ["CNPJ", "Cnpj", "cnpj", "CnpjCpf"]) ?? ""));
  if (cnpj) updates.cnpj = cnpj;

  const empresaNome =
    readStringByKeysFromUnknown(empresa, ["NomeFantazia", "NomeFantasia", "RazaoSocial"]) ?? null;
  if (empresaNome) updates.empresa = empresaNome;

  const grupo = readStringByKeysFromUnknown(empresa, ["Grupo", "grupo", "GrupoEmpresa", "grupoEmpresa"]);
  if (grupo) updates.grupo = grupo;

  const obsComercial =
    readStringByKeysFromUnknown(empresa, [
      "ObservacaoComercial",
      "observacaoComercial",
      "observacao_comercial",
      "ObsComercial",
      "obsComercial",
    ]) ?? readStringByKeysFromUnknown(payload, ["ObservacaoComercial", "observacaoComercial"]);
  if (obsComercial) updates.obs_comercial = obsComercial;

  const corte = parseNumberFromUnknown(readRecordValueByKeys(empresa, ["Corte", "corte", "DiaCorte", "diaCorte"]));
  if (corte !== null) updates.corte = corte;

  const venc = parseNumberFromUnknown(
    readRecordValueByKeys(empresa, ["Vencimento", "vencimento", "DiaVencimento", "diaVencimento", "Venc", "venc"]),
  );
  if (venc !== null) updates.venc = venc;

  const valor = resolveValorTitular(empresa);
  if (valor !== null) updates.valor = valor;

  const situacao =
    readStringByKeysFromUnknown(empresa, ["NomeSituacao", "nomeSituacao", "situacao", "status"]) ??
    readStringByKeysFromUnknown(payload, ["NomeSituacao", "nomeSituacao", "situacao", "status"]);
  if (situacao) updates.situacao = situacao;

  const cidade = readStringByKeysFromUnknown(empresa, ["MunicipioNome", "municipioNome", "Cidade", "cidade"]);
  if (cidade) updates.cidade = cidade;

  const uf = readStringByKeysFromUnknown(empresa, ["UfNome", "ufNome", "UF", "uf"]);
  if (uf) updates.uf = uf;

  const logradouro = readStringByKeysFromUnknown(empresa, ["Logradouro", "logradouro"]);
  const numero = readStringByKeysFromUnknown(empresa, ["Numero", "numero"]);
  const endereco = [logradouro?.trim() ?? "", numero?.trim() ?? ""].filter(Boolean).join(", ");
  if (endereco) updates.endereco = endereco;

  const complemento = readStringByKeysFromUnknown(empresa, ["Complemento", "complemento"]);
  if (complemento) updates.complemento = complemento;

  const bairro = readStringByKeysFromUnknown(empresa, ["BairroNome", "bairroNome", "Bairro", "bairro"]);
  if (bairro) updates.bairro = bairro;

  const cepRaw = readStringByKeysFromUnknown(empresa, [
    "Cep",
    "CEP",
    "cep",
    "CobrancaCep",
    "cobrancaCep",
    "FaturaCep",
    "faturaCep",
  ]);
  const cep = normalizeCep(cepRaw);
  if (cep) updates.cep = cep;

  return updates;
};

const validateUnlockSession = async (unlockTokenRaw: string | undefined, callerUserId: string) => {
  const unlockToken = (unlockTokenRaw ?? "").trim();
  if (!unlockToken) throw new Error("Token de liberacao obrigatorio.");

  const { data: sessionRow, error: sessionError } = await supabase
    .from("erp_sync_unlock_sessions")
    .select("id, expires_at, revoked_at")
    .eq("id", unlockToken)
    .eq("user_id", callerUserId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (sessionError) throw new Error(sessionError.message);
  if (!sessionRow) throw new Error("Sessao de liberacao invalida ou expirada.");

  await supabase
    .from("erp_sync_unlock_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", unlockToken)
    .eq("user_id", callerUserId);

  return unlockToken;
};

const normalizeComparableValue = (field: string, value: unknown): string | number | null => {
  if (value === null || value === undefined) return null;

  if (NUMERIC_CLIENTE_FIELDS.has(field)) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = parseNumberFromUnknown(value);
      return parsed === null ? null : parsed;
    }
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

const syncOneCode = async (code: string): Promise<SyncResult> => {
  try {
    const payload = await fetchOdontoartPayload(code);
    const empresa = extractEmpresaFromPayload(payload);

    if (!empresa) {
      return {
        code,
        status: "erp_not_found",
        updated_rows: 0,
        changed_rows: 0,
        fields: [],
        changes: [],
        message: "Empresa nao encontrada no ERP.",
      };
    }

    const updates = buildClienteUpdatePayload(empresa, payload);
    const fields = Object.keys(updates);

    if (!fields.length) {
      return {
        code,
        status: "no_mapped_fields",
        updated_rows: 0,
        changed_rows: 0,
        fields: [],
        changes: [],
        message: "Nenhum campo mapeado retornado pelo ERP para este codigo.",
      };
    }

    const selectColumns = Array.from(new Set(["id", ...fields])).join(", ");
    const { data: localRows, error: localReadError } = await supabase
      .from("clientes")
      .select(selectColumns)
      .eq("codigo", code);

    if (localReadError) {
      return {
        code,
        status: "failed",
        updated_rows: 0,
        changed_rows: 0,
        fields,
        changes: [],
        message: localReadError.message,
      };
    }

    if (!localRows?.length) {
      return {
        code,
        status: "local_not_found",
        updated_rows: 0,
        changed_rows: 0,
        fields,
        changes: [],
        message: "Codigo nao encontrado na base local.",
      };
    }

    const changedRowIds = new Set<string>();
    const changes = fields
      .map((field) => {
        const toValue = normalizeComparableValue(field, updates[field]);
        const fromValues: Array<string | number | null> = [];
        const fromValuesSeen = new Set<string>();
        let changedRowsCount = 0;

        localRows.forEach((row) => {
          const rowRecord = row as Record<string, unknown>;
          const currentValue = normalizeComparableValue(field, rowRecord[field]);
          const equalValues = currentValue === toValue;
          if (equalValues) return;

          changedRowsCount += 1;
          const rowId = rowRecord.id;
          if (typeof rowId === "string" && rowId) changedRowIds.add(rowId);

          const seenKey = `${typeof currentValue}:${String(currentValue)}`;
          if (!fromValuesSeen.has(seenKey)) {
            fromValuesSeen.add(seenKey);
            fromValues.push(currentValue);
          }
        });

        if (!changedRowsCount) return null;
        return {
          field,
          from_values: fromValues,
          to_value: toValue,
          changed_rows: changedRowsCount,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (!changes.length) {
      return {
        code,
        status: "no_changes",
        updated_rows: 0,
        changed_rows: 0,
        fields,
        changes: [],
        message: "Sem alteracoes detectadas na base local.",
      };
    }

    const { data: updatedRows, error: updateError } = await supabase
      .from("clientes")
      .update(updates)
      .eq("codigo", code)
      .select("id");

    if (updateError) {
      return {
        code,
        status: "failed",
        updated_rows: 0,
        changed_rows: 0,
        fields,
        changes: [],
        message: updateError.message,
      };
    }

    const updatedCount = (updatedRows ?? []).length;
    return {
      code,
      status: "updated",
      updated_rows: updatedCount,
      changed_rows: changedRowIds.size,
      fields,
      changes,
      message: null,
    };
  } catch (error) {
    return {
      code,
      status: "failed",
      updated_rows: 0,
      changed_rows: 0,
      fields: [],
      changes: [],
      message: error instanceof Error ? error.message : "Erro ao sincronizar codigo.",
    };
  }
};

const runWave = async (codes: string[]) => {
  const results = new Array<SyncResult>(codes.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= codes.length) return;
      results[current] = await syncOneCode(codes[current]);
      await sleep(120);
    }
  };

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, Math.max(1, codes.length)) }, () => worker());
  await Promise.all(workers);
  return results;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Metodo nao permitido." });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = extractBearerToken(authHeader);
  if (!token) {
    return jsonResponse(401, { error: "Token ausente." });
  }

  const callerUserId = await resolveCallerUserId(token);
  if (!callerUserId) {
    return jsonResponse(401, { error: "Token JWT invalido." });
  }

  const callerRole = await resolveCallerRole(callerUserId);
  if (callerRole !== "SUPERVISOR") {
    await appendManualLog(callerUserId, "access", "denied", { reason: "role_not_allowed", callerRole });
    return jsonResponse(403, { error: "Acesso negado." });
  }

  let body: {
    action?: "unlock" | "preview" | "execute-wave";
    payload?: UnlockPayload | PreviewPayload | ExecuteWavePayload;
  } | null = null;

  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Payload invalido." });
  }

  if (!body?.action || !body.payload) {
    return jsonResponse(400, { error: "Acao nao informada." });
  }

  if (body.action === "unlock") {
    const payload = body.payload as UnlockPayload;
    const releasePassword = (payload.release_password ?? "").trim();
    if (!releasePassword) {
      return jsonResponse(400, { error: "Senha de liberacao obrigatoria." });
    }

    const { data: passwordMatches, error: passwordError } = await supabase.rpc("erp_sync_password_matches", {
      p_password: releasePassword,
    });

    if (passwordError) {
      await appendManualLog(callerUserId, "unlock", "error", { error: passwordError.message });
      return jsonResponse(500, { error: "Falha ao validar senha de liberacao." });
    }

    if (!passwordMatches) {
      await appendManualLog(callerUserId, "unlock", "denied", { reason: "invalid_password" });
      return jsonResponse(403, { error: "Senha de liberacao invalida." });
    }

    const expiresAt = new Date(Date.now() + UNLOCK_TTL_MINUTES * 60 * 1000).toISOString();
    const { data: sessionRow, error: sessionError } = await supabase
      .from("erp_sync_unlock_sessions")
      .insert({
        user_id: callerUserId,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();

    if (sessionError || !sessionRow) {
      await appendManualLog(callerUserId, "unlock", "error", { error: sessionError?.message ?? "unknown" });
      return jsonResponse(500, { error: "Falha ao abrir sessao de liberacao." });
    }

    await appendManualLog(callerUserId, "unlock", "success", { expires_at: sessionRow.expires_at });
    return jsonResponse(200, {
      unlock_token: sessionRow.id,
      expires_at: sessionRow.expires_at,
      ttl_minutes: UNLOCK_TTL_MINUTES,
    });
  }

  if (body.action === "preview") {
    const payload = body.payload as PreviewPayload;

    try {
      await validateUnlockSession(payload.unlock_token, callerUserId);
      const codes = parseCodesFromUnknown(payload.codes);
      if (!codes.length) {
        return jsonResponse(400, { error: "Informe ao menos um codigo para preview." });
      }

      const { data: localRows, error: localError } = await supabase
        .from("clientes")
        .select("codigo, empresa")
        .in("codigo", codes);

      if (localError) throw localError;

      const statsByCode = new Map<string, { local_rows_count: number; sample_company: string | null }>();
      (localRows ?? []).forEach((row) => {
        const code = (row.codigo ?? "").trim();
        if (!code) return;
        const prev = statsByCode.get(code);
        if (!prev) {
          statsByCode.set(code, {
            local_rows_count: 1,
            sample_company: (row.empresa ?? null) as string | null,
          });
          return;
        }
        prev.local_rows_count += 1;
      });

      const foundCodes = codes.filter((code) => statsByCode.has(code));
      const missingCodes = codes.filter((code) => !statsByCode.has(code));

      const items = codes.map((code) => {
        const local = statsByCode.get(code);
        return {
          code,
          local_rows_count: local?.local_rows_count ?? 0,
          sample_company: local?.sample_company ?? null,
          found_local: Boolean(local),
        };
      });

      await appendManualLog(callerUserId, "preview", "success", {
        total_codes: codes.length,
        found_local: foundCodes.length,
        missing_local: missingCodes.length,
      });

      return jsonResponse(200, {
        normalized_codes: codes,
        total_codes: codes.length,
        found_local_count: foundCodes.length,
        missing_local_count: missingCodes.length,
        found_local_codes: foundCodes,
        missing_local_codes: missingCodes,
        recommended_wave_limit: Math.min(DEFAULT_WAVE_LIMIT, MAX_WAVE_LIMIT),
        max_wave_limit: MAX_WAVE_LIMIT,
        items,
      });
    } catch (error) {
      await appendManualLog(callerUserId, "preview", "error", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return jsonResponse(400, {
        error: error instanceof Error ? error.message : "Falha ao gerar preview.",
      });
    }
  }

  if (body.action === "execute-wave") {
    const payload = body.payload as ExecuteWavePayload;

    try {
      await validateUnlockSession(payload.unlock_token, callerUserId);
      const codes = parseCodesFromUnknown(payload.codes);
      if (!codes.length) {
        return jsonResponse(400, { error: "Informe ao menos um codigo para sincronizar." });
      }

      const offset = Math.max(0, Math.floor(Number(payload.offset ?? 0)));
      const requestedLimit = Math.floor(Number(payload.limit ?? DEFAULT_WAVE_LIMIT));
      const safeLimit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_WAVE_LIMIT, MAX_WAVE_LIMIT));

      const waveCodes = codes.slice(offset, offset + safeLimit);
      if (!waveCodes.length) {
        return jsonResponse(200, {
          processed_count: 0,
          next_offset: offset,
          has_more: false,
          remaining_count: 0,
          max_wave_limit: MAX_WAVE_LIMIT,
          results: [] as SyncResult[],
          summary: {
            updated: 0,
            no_changes: 0,
            local_not_found: 0,
            erp_not_found: 0,
            no_mapped_fields: 0,
            failed: 0,
          },
        });
      }

      const results = await runWave(waveCodes);
      const nextOffset = offset + waveCodes.length;
      const remainingCount = Math.max(0, codes.length - nextOffset);
      const summary = {
        updated: results.filter((item) => item.status === "updated").length,
        no_changes: results.filter((item) => item.status === "no_changes").length,
        local_not_found: results.filter((item) => item.status === "local_not_found").length,
        erp_not_found: results.filter((item) => item.status === "erp_not_found").length,
        no_mapped_fields: results.filter((item) => item.status === "no_mapped_fields").length,
        failed: results.filter((item) => item.status === "failed").length,
      };

      await appendManualLog(callerUserId, "execute-wave", "success", {
        offset,
        limit: safeLimit,
        processed_count: waveCodes.length,
        remaining_count: remainingCount,
        summary,
      });

      return jsonResponse(200, {
        processed_count: waveCodes.length,
        next_offset: nextOffset,
        has_more: remainingCount > 0,
        remaining_count: remainingCount,
        max_wave_limit: MAX_WAVE_LIMIT,
        results,
        summary,
      });
    } catch (error) {
      await appendManualLog(callerUserId, "execute-wave", "error", {
        error: error instanceof Error ? error.message : "unknown",
      });
      return jsonResponse(400, {
        error: error instanceof Error ? error.message : "Falha ao executar sincronizacao em lote.",
      });
    }
  }

  return jsonResponse(400, { error: "Acao desconhecida." });
});
