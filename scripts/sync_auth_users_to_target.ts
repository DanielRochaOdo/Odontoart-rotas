import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient, type User } from "@supabase/supabase-js";

type SourceUserRow = {
  id: string;
  aud: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  encrypted_password: string | null;
  email_confirmed_at: string | null;
  phone_confirmed_at: string | null;
  raw_app_meta_data: Record<string, unknown> | null;
  raw_user_meta_data: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  reauthentication_sent_at: string | null;
  is_sso_user: boolean | null;
  is_anonymous: boolean | null;
};

type ProfilesRow = {
  user_id: string;
  role: string | null;
  nome: string | null;
  display_name: string | null;
  supervisor_id: string | null;
  vendedor_id: string | null;
};

const TARGET_URL = process.env.TARGET_SUPABASE_URL;
const TARGET_SERVICE_ROLE_KEY = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
const SOURCE_USERS_FILE =
  process.env.SOURCE_USERS_FILE ?? path.join("scripts", ".tmp_auth_users_old.json");

if (!TARGET_URL || !TARGET_SERVICE_ROLE_KEY) {
  console.error("Missing TARGET_SUPABASE_URL or TARGET_SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

if (!fs.existsSync(SOURCE_USERS_FILE)) {
  console.error(`Source users file not found: ${SOURCE_USERS_FILE}`);
  process.exit(1);
}

const target = createClient(TARGET_URL, TARGET_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 8): Promise<T> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const waitMs = Math.min(1000 * 2 ** (i - 1), 10000);
      console.warn(`[retry ${i}/${attempts}] ${label} failed. waiting ${waitMs}ms`);
      await sleep(waitMs);
    }
  }
  throw lastError;
}

function loadSourceUsers(filePath: string): SourceUserRow[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as { rows?: SourceUserRow[] };
  return parsed.rows ?? [];
}

async function listAllTargetUsers(): Promise<User[]> {
  const users: User[] = [];
  const perPage = 100;
  let page = 1;
  while (true) {
    const result = await withRetry(`target listUsers page=${page}`, async () => {
      const { data, error } = await target.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      return data.users;
    });
    users.push(...result);
    if (result.length < perPage) break;
    page += 1;
  }
  return users;
}

async function loadProfilesByUserId(): Promise<Map<string, ProfilesRow>> {
  const out = new Map<string, ProfilesRow>();
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const rows = await withRetry(`fetch profiles ${from}`, async () => {
      const { data, error } = await target
        .from("profiles")
        .select("user_id,role,nome,display_name,supervisor_id,vendedor_id")
        .order("user_id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      return (data ?? []) as ProfilesRow[];
    });

    for (const row of rows) {
      if (row.user_id) out.set(row.user_id, row);
    }

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

function buildUserMetadata(source: SourceUserRow, profile: ProfilesRow | undefined) {
  const metadata: Record<string, unknown> = { ...(source.raw_user_meta_data ?? {}) };

  if (source.email_confirmed_at) metadata.email_verified = true;
  if (profile) {
    metadata.role = profile.role ?? metadata.role ?? "SUPERVISOR";
    metadata.nome = profile.nome ?? profile.display_name ?? metadata.nome ?? null;
    metadata.display_name =
      profile.display_name ?? profile.nome ?? metadata.display_name ?? metadata.nome ?? null;
    metadata.supervisor_id = profile.supervisor_id ?? null;
    metadata.vendedor_id = profile.vendedor_id ?? null;
  } else {
    metadata.role = metadata.role ?? "SUPERVISOR";
    metadata.nome = metadata.nome ?? metadata.display_name ?? source.email ?? "USUARIO";
    metadata.display_name = metadata.display_name ?? metadata.nome;
    metadata.supervisor_id = metadata.supervisor_id ?? null;
    metadata.vendedor_id = metadata.vendedor_id ?? null;
  }

  return metadata;
}

async function deleteUsersNotInSource(sourceIds: Set<string>, targetUsers: User[]) {
  const extras = targetUsers.filter((u) => !sourceIds.has(u.id));
  if (extras.length === 0) return 0;

  for (const user of extras) {
    await withRetry(`delete target extra user ${user.id}`, async () => {
      const { error } = await target.auth.admin.deleteUser(user.id);
      if (error) throw error;
    });
  }
  return extras.length;
}

async function syncUsers() {
  const sourceUsers = loadSourceUsers(SOURCE_USERS_FILE);
  console.log(`Loaded source users: ${sourceUsers.length}`);

  const sourceById = new Map(sourceUsers.map((u) => [u.id, u]));
  const sourceIds = new Set(sourceById.keys());

  const targetUsersBefore = await listAllTargetUsers();
  const targetById = new Map(targetUsersBefore.map((u) => [u.id, u]));
  const removed = await deleteUsersNotInSource(sourceIds, targetUsersBefore);

  const profilesByUserId = await loadProfilesByUserId();
  console.log(`Profiles loaded: ${profilesByUserId.size}`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const sourceUser of sourceUsers) {
    const hasEmail = Boolean(sourceUser.email);
    const hasPhone = Boolean(sourceUser.phone);
    const hasPasswordHash = Boolean(sourceUser.encrypted_password);
    if (!hasEmail && !hasPhone) {
      skipped += 1;
      continue;
    }

    const profile = profilesByUserId.get(sourceUser.id);
    const userMetadata = buildUserMetadata(sourceUser, profile);
    const appMetadata =
      sourceUser.raw_app_meta_data ??
      ({
        provider: sourceUser.email ? "email" : "phone",
        providers: [sourceUser.email ? "email" : "phone"],
      } as Record<string, unknown>);

    const role = sourceUser.role ?? "authenticated";

    const commonPayload = {
      email: sourceUser.email ?? undefined,
      phone: sourceUser.phone ?? undefined,
      app_metadata: appMetadata,
      user_metadata: userMetadata,
      email_confirm: Boolean(sourceUser.email_confirmed_at),
      phone_confirm: Boolean(sourceUser.phone_confirmed_at),
      role,
      password_hash: hasPasswordHash ? sourceUser.encrypted_password ?? undefined : undefined,
    };

    if (targetById.has(sourceUser.id)) {
      await withRetry(`update target user ${sourceUser.id}`, async () => {
        const { error } = await target.auth.admin.updateUserById(sourceUser.id, commonPayload);
        if (error) throw error;
      });
      updated += 1;
    } else {
      await withRetry(`create target user ${sourceUser.id}`, async () => {
        const { error } = await target.auth.admin.createUser({
          id: sourceUser.id,
          ...commonPayload,
          ...(hasPasswordHash ? {} : { password: `Tmp#${sourceUser.id.replace(/-/g, "").slice(0, 18)}9a` }),
        });
        if (error) throw error;
      });
      created += 1;
    }
  }

  const targetUsersAfter = await listAllTargetUsers();
  console.log(
    `Sync done. source=${sourceUsers.length} target_before=${targetUsersBefore.length} target_after=${targetUsersAfter.length} removed=${removed} created=${created} updated=${updated} skipped=${skipped}`
  );
}

syncUsers().catch((error) => {
  console.error("Auth sync failed:", error);
  process.exit(1);
});

