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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return jsonResponse(401, { error: "Token ausente." });
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return jsonResponse(401, { error: "Sessao invalida." });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (profileError || profile?.role !== "SUPERVISOR") {
    return jsonResponse(403, { error: "Acesso negado." });
  }

  let body: {
    action?: string;
    payload?: CreatePayload | DeletePayload | UpdatePayload | ListEmailsPayload;
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
        supervisor_id: resolvedSupervisorId,
        vendedor_id: resolvedVendedorId,
      })
      .eq("user_id", createdUser.user.id)
      .select(
        "id, user_id, role, display_name, nome, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
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

    const { error: deleteError } = await supabase.auth.admin.deleteUser(payload.user_id);
    if (deleteError) {
      return jsonResponse(400, { error: deleteError.message });
    }

    return jsonResponse(200, { success: true });
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

    const remainingIds = new Set(targetIds);
    const emailsByUserId: Record<string, string> = {};
    let page = 1;
    const perPage = 1000;

    while (remainingIds.size > 0) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) {
        return jsonResponse(400, { error: error.message });
      }

      const users = data?.users ?? [];
      if (users.length === 0) break;

      for (const authUser of users) {
        if (!remainingIds.has(authUser.id)) continue;
        emailsByUserId[authUser.id] = authUser.email ?? "";
        remainingIds.delete(authUser.id);
      }

      if (users.length < perPage) break;
      page += 1;
    }

    return jsonResponse(200, { emails: emailsByUserId });
  }

  return jsonResponse(400, { error: "Acao desconhecida." });
});
