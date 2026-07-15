import type { SystemNewsModule, SystemNewsType } from "../lib/systemNewsApi";

export type SystemUpdateNotification = {
  id: string;
  title: string;
  descriptionPreview: string;
  type: SystemNewsType;
  module: SystemNewsModule;
  publishedAt: string;
  isRead: boolean;
};

export type SystemUpdateNotificationsResult = {
  notifications: SystemUpdateNotification[];
  totalUnread: number;
};
