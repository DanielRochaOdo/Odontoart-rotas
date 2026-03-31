import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept-language",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";
const ALLOWED_ENDPOINTS = new Set(["search", "reverse"]);
const USER_AGENT = "Odontoart-rotas/1.0 (+https://rotas.odontoart.com)";

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

const resolveEndpoint = (path: string) => {
  const normalized = path.toLowerCase().replace(/\/+$/, "");
  const endpoint = normalized.split("/").pop() ?? "";
  return ALLOWED_ENDPOINTS.has(endpoint) ? endpoint : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return jsonResponse(405, { error: "Method not allowed." });
  }

  const url = new URL(req.url);
  const endpoint = resolveEndpoint(url.pathname);
  if (!endpoint) {
    return jsonResponse(404, { error: "Endpoint not found." });
  }

  const targetUrl = new URL(`${NOMINATIM_BASE_URL}/${endpoint}`);
  url.searchParams.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });

  try {
    const response = await fetch(targetUrl.toString(), {
      headers: {
        "Accept-Language": req.headers.get("Accept-Language") ?? "pt-BR",
        "User-Agent": USER_AGENT,
      },
    });

    const contentType = response.headers.get("Content-Type") ?? "application/json; charset=utf-8";
    const retryAfter = response.headers.get("Retry-After");
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=60",
        ...(retryAfter ? { "Retry-After": retryAfter } : {}),
      },
    });
  } catch (error) {
    console.error("Nominatim proxy error:", error);
    return jsonResponse(502, { error: "Falha ao consultar geocodificador." });
  }
});

