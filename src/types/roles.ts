export type UserRole = "VENDEDOR" | "SUPERVISOR" | "ASSISTENTE";

export const ROLE_LABELS: Record<UserRole, string> = {
  VENDEDOR: "Vendedor",
  SUPERVISOR: "Supervisor",
  ASSISTENTE: "Assistente",
};

export const ROLE_LEVEL: Record<UserRole, number> = {
  VENDEDOR: 1,
  ASSISTENTE: 2,
  SUPERVISOR: 3,
};
