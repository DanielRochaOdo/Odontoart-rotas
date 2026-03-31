import "dotenv/config";
import crypto from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

const SOURCE_URL = process.env.SOURCE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SOURCE_SERVICE_ROLE_KEY =
  process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_URL = process.env.TARGET_SUPABASE_URL;
const TARGET_SERVICE_ROLE_KEY = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;

if (!SOURCE_URL || !SOURCE_SERVICE_ROLE_KEY || !TARGET_URL || !TARGET_SERVICE_ROLE_KEY) {
  console.error("Missing required env vars.");
  console.error(
    "Required: SOURCE_SUPABASE_URL, SOURCE_SUPABASE_SERVICE_ROLE_KEY, TARGET_SUPABASE_URL, TARGET_SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const TABLES_INSERT_ORDER = [
  "agenda_headers_map",
  "clientes",
  "agenda",
  "profiles",
  "routes",
  "route_stops",
  "visits",
  "pre_cadastros",
  "aceite_digital",
  "audit_logs",
] as const;

const TABLES_DELETE_ORDER = [
  "route_stops",
  "visits",
  "pre_cadastros",
  "aceite_digital",
  "audit_logs",
  "routes",
  "profiles",
  "agenda",
  "clientes",
  "agenda_headers_map",
] as const;

const USER_ID_COLUMNS: Partial<Record<(typeof TABLES_INSERT_ORDER)[number], string[]>> = {
  profiles: ["user_id"],
  routes: ["assigned_to_user_id", "created_by"],
  visits: ["assigned_to_user_id", "created_by"],
  pre_cadastros: ["created_by_user_id", "reviewed_by_user_id"],
  aceite_digital: ["vendor_user_id", "created_by"],
  audit_logs: ["user_id"],
};

const OMIT_INSERT_COLUMNS: Partial<Record<(typeof TABLES_INSERT_ORDER)[number], string[]>> = {
  clientes: ["dedupe_key"],
  agenda: ["dedupe_key"],
};

const source = createClient(SOURCE_URL, SOURCE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const target = createClient(TARGET_URL, TARGET_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function randomPassword(): string {
  return `Tmp#${crypto.randomBytes(18).toString("base64url")}9a`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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

async function listAllUsers(client: typeof source): Promise<User[]> {
  const users: User[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const result = await withRetry(`listUsers page=${page}`, async () => {
      const { data, error } = await client.auth.admin.listUsers({ page, perPage });
      if (error) throw error;
      return data.users;
    });

    users.push(...result);
    if (result.length < perPage) break;
    page += 1;
  }

  return users;
}

async function migrateAuthUsers(): Promise<void> {
  console.log("Migrating auth users...");
  const sourceUsers = await listAllUsers(source);
  const targetUsers = await listAllUsers(target);

  const targetById = new Map(targetUsers.map((u) => [u.id, u]));
  const targetByEmail = new Map(
    targetUsers.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const user of sourceUsers) {
    const existingById = targetById.get(user.id);
    if (existingById) {
      const { error } = await withRetry(`updateUserById ${user.id}`, async () =>
        target.auth.admin.updateUserById(user.id, {
          email: user.email ?? undefined,
          phone: user.phone ?? undefined,
          app_metadata: user.app_metadata ?? {},
          user_metadata: user.user_metadata ?? {},
          email_confirm: Boolean(user.email_confirmed_at || user.confirmed_at),
          phone_confirm: Boolean(user.phone_confirmed_at),
          role: user.role ?? undefined,
        })
      );
      if (error) throw error;
      updated += 1;
      continue;
    }

    const normalizedEmail = user.email ? String(user.email).toLowerCase() : null;
    if (normalizedEmail) {
      const existingByEmail = targetByEmail.get(normalizedEmail);
      if (existingByEmail && existingByEmail.id !== user.id) {
        // Keep source UUIDs to preserve FKs in public tables.
        const { error: deleteError } = await withRetry(`delete conflicting user ${existingByEmail.id}`, async () =>
          target.auth.admin.deleteUser(existingByEmail.id)
        );
        if (deleteError) throw deleteError;
      }
    }

    const createPayload: Parameters<typeof target.auth.admin.createUser>[0] = {
      id: user.id,
      email: user.email ?? undefined,
      phone: user.phone ?? undefined,
      app_metadata: user.app_metadata ?? {},
      user_metadata: user.user_metadata ?? {},
      email_confirm: Boolean(user.email_confirmed_at || user.confirmed_at),
      phone_confirm: Boolean(user.phone_confirmed_at),
      role: user.role ?? undefined,
      password: randomPassword(),
    };

    if (!createPayload.email && !createPayload.phone) {
      skipped += 1;
      continue;
    }

    const { error } = await withRetry(`createUser ${user.id}`, async () =>
      target.auth.admin.createUser(createPayload)
    );
    if (error) throw error;
    created += 1;
  }

  console.log(
    `Auth users done. source=${sourceUsers.length} created=${created} updated=${updated} skipped=${skipped}`
  );
}

async function fetchAllRows(table: string): Promise<Row[]> {
  const pageSize = 1000;
  const all: Row[] = [];
  let from = 0;

  while (true) {
    const data = await withRetry(`fetch ${table} range ${from}-${from + pageSize - 1}`, async () => {
      const { data, error } = await source
        .from(table)
        .select("*")
        .order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      return (data ?? []) as Row[];
    });

    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

async function purgeTable(table: string): Promise<void> {
  while (true) {
    const rows = await withRetry(`list ids from target ${table}`, async () => {
      const { data, error } = await target.from(table).select("id").range(0, 999);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string }>;
    });

    if (rows.length === 0) return;
    const ids = rows.map((row) => row.id);
    const chunks = chunk(ids, 100);

    for (const part of chunks) {
      await withRetry(`delete ids from ${table}`, async () => {
        const { error } = await target.from(table).delete().in("id", part);
        if (error) throw error;
      });
    }
  }
}

async function insertRows(table: string, rows: Row[]): Promise<void> {
  const omit = OMIT_INSERT_COLUMNS[table as keyof typeof OMIT_INSERT_COLUMNS] ?? [];
  const sanitizedRows =
    omit.length === 0
      ? rows
      : rows.map((row) => {
          const copy: Row = { ...row };
          for (const key of omit) delete copy[key];
          return copy;
        });

  const chunks = chunk(sanitizedRows, 200);
  for (let i = 0; i < chunks.length; i += 1) {
    const batch = chunks[i];
    await withRetry(`upsert ${table} batch ${i + 1}/${chunks.length}`, async () => {
      const { error } = await target.from(table).upsert(batch, { onConflict: "id" });
      if (error) throw error;
    });
  }
}

function collectReferencedUserIds(sourceData: Map<string, Row[]>): string[] {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const ids = new Set<string>();
  let discarded = 0;
  for (const [table, rows] of sourceData.entries()) {
    const cols = USER_ID_COLUMNS[table as keyof typeof USER_ID_COLUMNS] ?? [];
    if (cols.length === 0) continue;
    for (const row of rows) {
      for (const col of cols) {
        const value = row[col];
        if (typeof value === "string" && value.trim().length > 0) {
          if (uuidRegex.test(value)) {
            ids.add(value);
          } else {
            discarded += 1;
          }
        }
      }
    }
  }
  if (discarded > 0) {
    console.warn(`Discarded ${discarded} non-UUID user references from source rows.`);
  }
  return [...ids];
}

async function ensureTargetAuthUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    console.log("No referenced auth user IDs found in public tables.");
    return;
  }

  const targetUsers = await listAllUsers(target);
  const targetIds = new Set(targetUsers.map((u) => u.id));
  const missing = userIds.filter((id) => !targetIds.has(id));

  if (missing.length === 0) {
    console.log("All referenced auth user IDs already exist on target.");
    return;
  }

  console.log(`Creating ${missing.length} placeholder auth users on target...`);
  let created = 0;
  for (const id of missing) {
    const payload: Parameters<typeof target.auth.admin.createUser>[0] = {
      id,
      email: `migrated+${id}@example.local`,
      password: randomPassword(),
      email_confirm: true,
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {
        migrated_placeholder: true,
        role: "SUPERVISOR",
        nome: "MIGRATED PLACEHOLDER",
        display_name: "MIGRATED PLACEHOLDER",
        supervisor_id: null,
        vendedor_id: null,
      },
      role: "authenticated",
    };

    const { error } = await withRetry(`create placeholder auth user ${id}`, async () =>
      target.auth.admin.createUser(payload)
    );
    if (error) throw error;
    created += 1;
  }

  console.log(`Placeholder auth users created: ${created}`);
}

async function countRows(client: typeof source, table: string): Promise<number> {
  const { count, error } = await withRetry(`count ${table}`, async () =>
    client.from(table).select("id", { count: "exact", head: true })
  );
  if (error) throw error;
  return count ?? 0;
}

async function migrateTables(): Promise<void> {
  console.log("Fetching source rows...");
  const sourceData = new Map<string, Row[]>();
  for (const table of TABLES_INSERT_ORDER) {
    const rows = await fetchAllRows(table);
    sourceData.set(table, rows);
    console.log(`source ${table}: ${rows.length}`);
  }

  const referencedUserIds = collectReferencedUserIds(sourceData);
  console.log(`Referenced auth user IDs in public data: ${referencedUserIds.length}`);
  await ensureTargetAuthUsers(referencedUserIds);

  console.log("Purging target rows...");
  for (const table of TABLES_DELETE_ORDER) {
    await purgeTable(table);
    console.log(`target ${table}: purged`);
  }

  console.log("Inserting rows into target...");
  for (const table of TABLES_INSERT_ORDER) {
    const rows = sourceData.get(table) ?? [];
    if (rows.length === 0) {
      console.log(`target ${table}: skipped (0 rows)`);
      continue;
    }
    if (table === "agenda") {
      // clientes triggers may pre-create agenda rows; reset before replaying canonical agenda data.
      await purgeTable("agenda");
      console.log("target agenda: purged before replay");
    }
    if (table === "audit_logs") {
      // Previous inserts trigger audit rows; reset logs right before replaying source logs.
      await purgeTable("audit_logs");
      console.log("target audit_logs: purged before replay");
    }
    await insertRows(table, rows);
    console.log(`target ${table}: inserted ${rows.length}`);
  }

  console.log("Validating counts...");
  for (const table of TABLES_INSERT_ORDER) {
    const sourceCount = await countRows(source, table);
    const targetCount = await countRows(target, table);
    const ok = sourceCount === targetCount ? "OK" : "DIFF";
    console.log(`${table}: source=${sourceCount} target=${targetCount} [${ok}]`);
  }
}

async function main(): Promise<void> {
  console.log(`SOURCE: ${SOURCE_URL}`);
  console.log(`TARGET: ${TARGET_URL}`);
  if (process.env.SKIP_AUTH_MIGRATION === "1") {
    console.log("Skipping auth users migration (SKIP_AUTH_MIGRATION=1).");
  } else {
    await migrateAuthUsers();
  }
  await migrateTables();
  console.log("Migration completed.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
