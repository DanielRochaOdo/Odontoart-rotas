import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

const ODONTOART_EMPRESA_URL = "https://odontoart.s4e.com.br/api/empresa/BuscaEmpresas";
const ODONTOART_TIMEOUT_MS = 12000;
const ODONTOART_MAX_ATTEMPTS = 3;

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const shouldRetryStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

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

const fetchOdontoartPayload = async (token: string, empresaId: string) => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= ODONTOART_MAX_ATTEMPTS; attempt += 1) {
    const search = new URLSearchParams({ token, empresaId });
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
          throw new Error(`Falha ao consultar Odontoart (${response.status}).`);
        }
        await sleep(250 * attempt);
        continue;
      }

      return (await response.json()) as unknown;
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const isTransientNetwork =
        isAbort || (error instanceof TypeError && /network|fetch|failed/i.test(error.message));
      lastError = isAbort
        ? new Error("Tempo limite excedido ao consultar API da Odontoart.")
        : error instanceof Error
          ? error
          : new Error("Erro de comunicacao com API da Odontoart.");

      if (!isTransientNetwork || attempt >= ODONTOART_MAX_ATTEMPTS) {
        throw lastError;
      }
      await sleep(250 * attempt);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastError) throw lastError;
  throw new Error("Falha ao consultar API da Odontoart.");
};

const hasEmpresa = (payload: unknown) => {
  if (!payload || typeof payload !== "object") return false;
  const record = payload as Record<string, unknown>;
  const dados = record.dados;
  if (Array.isArray(dados) && dados.length > 0 && typeof dados[0] === "object" && dados[0] !== null) return true;
  if (Array.isArray(payload) && payload.length > 0 && typeof payload[0] === "object" && payload[0] !== null) return true;
  return false;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Metodo nao permitido." });
  }

  const token =
    Deno.env.get("ODONTOART_TOKEN")?.trim() ||
    Deno.env.get("VITE_ODONTOART_TOKEN")?.trim() ||
    "";
  if (!token) {
    return jsonResponse(500, { error: "ODONTOART_TOKEN nao configurado na function." });
  }

  let body: { empresaId?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Payload invalido." });
  }

  const empresaId = body?.empresaId?.trim() ?? "";
  if (!empresaId) {
    return jsonResponse(400, { error: "empresaId obrigatorio." });
  }

  try {
    const candidates = buildCodigoCandidates(empresaId);
    let lastPayload: unknown = null;

    for (const candidate of candidates) {
      const payload = await fetchOdontoartPayload(token, candidate);
      lastPayload = payload;
      if (hasEmpresa(payload)) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify(lastPayload ?? { codigo: 1, dados: [], erros: null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return jsonResponse(502, {
      error: error instanceof Error ? error.message : "Erro ao consultar Odontoart.",
    });
  }
});

