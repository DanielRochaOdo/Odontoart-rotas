import { supabase } from "./supabase";
import type { UserRole } from "../types/roles";

export type ManagedProfile = {
  id: string;
  user_id: string | null;
  role: UserRole;
  display_name: string | null;
  supervisor_id: string | null;
  vendedor_id: string | null;
  supervisor?: { id: string; display_name: string | null } | null;
  vendedor?: { id: string; display_name: string | null } | null;
};

export const fetchManagedProfiles = async () => {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, user_id, role, display_name, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
    )
    .order("display_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as ManagedProfile[];
};

export const updateManagedProfile = async (payload: {
  id: string;
  display_name?: string | null;
  supervisor_id?: string | null;
  vendedor_id?: string | null;
}) => {
  const { data, error } = await supabase
    .from("profiles")
    .update({
      display_name: payload.display_name ?? null,
      supervisor_id: payload.supervisor_id ?? null,
      vendedor_id: payload.vendedor_id ?? null,
    })
    .eq("id", payload.id)
    .select(
      "id, user_id, role, display_name, supervisor_id, vendedor_id, supervisor:supervisor_id (id, display_name), vendedor:vendedor_id (id, display_name)",
    )
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as ManagedProfile;
};

export const createManagedUser = async (payload: {
  email: string;
  password: string;
  display_name: string;
  role: UserRole;
  supervisor_id?: string | null;
  vendedor_id?: string | null;
}) => {
  const { data, error } = await supabase.functions.invoke("manage-users", {
    body: { action: "create", payload },
  });

  if (error) throw new Error(error.message);
  if (!data?.profile) throw new Error("Resposta invalida ao criar usuario.");
  return data.profile as ManagedProfile;
};

export const deleteManagedUser = async (user_id: string) => {
  const { data, error } = await supabase.functions.invoke("manage-users", {
    body: { action: "delete", payload: { user_id } },
  });

  if (error) throw new Error(error.message);
  return data ?? { success: true };
};

export const updateManagedUserCredentials = async (payload: {
  user_id: string;
  email?: string | null;
  password?: string | null;
}) => {
  const { data, error } = await supabase.functions.invoke("manage-users", {
    body: { action: "update", payload },
  });

  if (error) throw new Error(error.message);
  return data ?? { success: true };
};

export const deleteProfileOnly = async (id: string) => {
  const { error } = await supabase.from("profiles").delete().eq("id", id);
  if (error) throw new Error(error.message);
};
