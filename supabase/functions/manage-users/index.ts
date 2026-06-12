import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CreatePayload = {
  email: string;
  password: string;
  display_name: string;
  nome?: string | null;
  role: "VENDEDOR" | "ASSISTENTE" | "SUPERVISOR";
  can_access_pre_cadastro?: boolean;
  can_access_next_route_dashboard?: boolean;
  supervisor_id?: string | null;
  vendedor_id?: string | null;
};

type DeletePayload = {
  user_id: string;
};

type UpdatePayload = {
  user_id: string;
  email?: string | null;
  password?: string | null;
};

type ResetAccessPayload = {
  user_id: string;
};

type ResetAllAccessPayload = Record<string, never>;

type ListEmailsPayload = {
  user_ids: string[];
};

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const chunkArray = <T>(items: T[], chunkSize: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
};

const isMissingUserError = (message: string) => {
  const normalized = message.toLowerCase();
  return normalized.includes("not found") || normalized.includes("does not exist");
};

const extractBearerToken = (authorizationHeader: string) => {
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

const resolveCallerUserId = async (token: string) => {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return data.user.id;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", callerUserId)
    .single();

  if (profileError || profile?.role !== "SUPERVISOR") {
    return jsonResponse(403, { error: "Acesso negado." });
  }

  let body: {
    action?: string;
    payload?: CreatePayload | DeletePayload | UpdatePayload | ResetAccessPayload | ResetAllAccessPayload | ListEmailsPayload;
  } | null = null;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { error: "Payload invalido." });
  }

  if (!body?.action || !body.payload) {
    return jsonResponse(400, { error: "Acao nao informada." });
  }

  if (body.action === "create") {
    const payload = body.payload as CreatePayload;
    if (!payload.email || !payload.password || !payload.display_name || !payload.role) {
      return jsonResponse(400, { error: "Dados obrigatorios ausentes." });
    }
    if (payload.role === "VENDEDOR" && !payload.supervisor_id) {
      return jsonResponse(400, { error: "Selecione um supervisor." });
    }
    const resolvedSupervisorId = payload.role === "VENDEDOR" ? payload.supervisor_id ?? null : null;
    const resolvedVendedorId = payload.role === "ASSISTENTE" ? null : payload.vendedor_id ?? null;
    const resolvedName = payload.nome ?? payload.display_name;
    const resolvedCanAccessPreCadastro = payload.role === "VENDEDOR"
      ? Boolean(payload.can_access_pre_cadastro)
      : false;
    const resolvedCanAccessNextRouteDashboard = payload.role === "VENDEDOR"
      ? Boolean(payload.can_access_next_route_dashboard)
      : false;

    const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        display_name: resolvedName,
        nome: resolvedName,
        role: payload.role,
        supervisor_id: resolvedSupervisorId,
        vendedor_id: resolvedVendedorId,
        can_access_pre_cadastro: resolvedCanAccessPreCadastro,
        can_access_next_route_dashboard: resolvedCanAccessNextRouteDashboard,
      },
    });

    if (createError || !createdUser?.user) {
      return jsonResponse(400, { error: createError?.message ?? "Erro ao criar usuario." });
    }

    const { data: updatedProfile, error: updateError } = await supabase
      .from("profiles")
      .update({
        role: payload.role,
        display_name: resolvedName,
        nome: resolvedName,
        can_access_pre_cadastro: resolvedCanAccessPreCadastro,
        can_access_next_route_dashboard: resolvedCanAccessNextRouteDashboard,
        supervisor_id: resolvedSupervisorId,
        vendedor_id: resolvedVendedorId,
      })
      .eq("user_id", createdUser.user.id)
      .select(
        "id, user_id, role, display_name, nome, can_access_pre_cadastro, can_access_next_route_dashboard, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
      )
      .single();

    if (updateError || !updatedProfile) {
      return jsonResponse(400, { error: updateError?.message ?? "Erro ao atualizar perfil." });
    }

    return jsonResponse(200, { profile: updatedProfile });
  }

  if (body.action === "update") {
    const payload = body.payload as UpdatePayload;
    if (!payload.user_id) {
      return jsonResponse(400, { error: "User id obrigatorio." });
    }

    if (!payload.email && !payload.password) {
      return jsonResponse(400, { error: "Informe email ou senha para atualizar." });
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(payload.user_id, {
      email: payload.email ?? undefined,
      password: payload.password ?? undefined,
      email_confirm: payload.email ? true : undefined,
    });

    if (updateError) {
      return jsonResponse(400, { error: updateError.message });
    }

    return jsonResponse(200, { success: true });
  }

  if (body.action === "delete") {
    const payload = body.payload as DeletePayload;
    if (!payload.user_id) {
      return jsonResponse(400, { error: "User id obrigatorio." });
    }

    const cleanupSteps: Array<Promise<{ error: { message: string } | null }>> = [
      supabase.from("profiles").delete().eq("user_id", payload.user_id),
    ];

    for (const step of cleanupSteps) {
      const { error } = await step;
      if (error) {
        return jsonResponse(400, { error: error.message });
      }
    }

    const { error: deleteError } = await supabase.auth.admin.deleteUser(payload.user_id);
    if (deleteError && !isMissingUserError(deleteError.message)) {
      return jsonResponse(400, { error: deleteError.message });
    }

    return jsonResponse(200, { success: true });
  }

  if (body.action === "reset-access") {
    const payload = body.payload as ResetAccessPayload;
    if (!payload.user_id) {
      return jsonResponse(400, { error: "User id obrigatorio." });
    }

    const forceReauthAfter = new Date().toISOString();
    const { error: profileUpdateError } = await supabase
      .from("profiles")
      .update({ force_reauth_after: forceReauthAfter })
      .eq("user_id", payload.user_id);

    if (profileUpdateError) {
      return jsonResponse(400, { error: profileUpdateError.message });
    }

    return jsonResponse(200, {
      success: true,
      user_id: payload.user_id,
      force_reauth_after: forceReauthAfter,
      scope: "single-user",
    });
  }

  if (body.action === "reset-all-access") {
    const { data: resetData, error: resetError } = await supabase.rpc("reset_all_users_access");

    if (resetError) {
      return jsonResponse(400, { error: resetError.message });
    }

    return jsonResponse(200, {
      success: true,
      ...(typeof resetData === "object" && resetData ? (resetData as Record<string, unknown>) : {}),
    });
  }

  if (body.action === "list-emails") {
    const payload = body.payload as ListEmailsPayload;
    if (!Array.isArray(payload.user_ids)) {
      return jsonResponse(400, { error: "user_ids deve ser um array." });
    }

    const targetIds = [...new Set(payload.user_ids.filter(Boolean))];
    if (targetIds.length === 0) {
      return jsonResponse(200, { emails: {} });
    }

    const emailsByUserId: Record<string, string> = {};
    const missingUserIds: string[] = [];
    const warnings: string[] = [];

    const idChunks = chunkArray(targetIds, 50);
    for (const idChunk of idChunks) {
      const results = await Promise.allSettled(
        idChunk.map((userId) => supabase.auth.admin.getUserById(userId)),
      );

      for (let index = 0; index < results.length; index += 1) {
        const userId = idChunk[index];
        const result = results[index];

        if (result.status === "rejected") {
          missingUserIds.push(userId);
          warnings.push(`Falha ao buscar usuario ${userId}.`);
          continue;
        }

        const { data, error } = result.value;
        if (error) {
          if (isMissingUserError(error.message)) {
            missingUserIds.push(userId);
            continue;
          }
          warnings.push(`Falha ao buscar usuario ${userId}: ${error.message}`);
          continue;
        }

        const email = data?.user?.email;
        if (!email) {
          missingUserIds.push(userId);
          continue;
        }
        emailsByUserId[userId] = email;
      }
    }

    return jsonResponse(200, {
      emails: emailsByUserId,
      missing_user_ids: missingUserIds,
      warnings,
    });
  }

  return jsonResponse(400, { error: "Acao desconhecida." });
});
