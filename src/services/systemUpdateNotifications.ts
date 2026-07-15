import { supabase } from "../lib/supabase";
import type { SystemUpdateNotificationsResult } from "../types/systemUpdateNotifications";

export const fetchSystemUpdateNotifications = async (): Promise<SystemUpdateNotificationsResult> => {
  const { data, error } = await supabase.rpc("system_news_notifications_for_current_user", {
    p_limit: 5,
  });
  if (error) throw new Error(error.message);
  const payload = (data ?? {}) as {
    notifications?: SystemUpdateNotificationsResult["notifications"];
    totalUnread?: number;
  };
  return {
    notifications: payload.notifications ?? [],
    totalUnread: payload.totalUnread ?? 0,
  };
};

export const markSystemUpdateAsRead = async (updateId: string) => {
  const { error } = await supabase.rpc("system_news_mark_as_read", { p_update_id: updateId });
  if (error) throw new Error(error.message);
};
