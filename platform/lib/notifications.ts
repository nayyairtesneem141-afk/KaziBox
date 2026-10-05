import { NotificationItem } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';

/**
 * Fetch notifications for current workspace
 * In Supabase: const { data } = await supabase.from('notifications').select('*').eq('company_id', companyId).order('created_at', { ascending: false });
 */
export async function getNotifications(companyId: string): Promise<NotificationItem[]> {
  const store = getStore();
  return store.notifications
    .filter((n) => n.company_id === companyId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Mark single notification as read
 * In Supabase: await supabase.from('notifications').update({ read: true }).eq('id', notificationId);
 */
export async function markNotificationAsRead(notificationId: string): Promise<boolean> {
  const store = getStore();
  const idx = store.notifications.findIndex((n) => n.id === notificationId);
  if (idx !== -1) {
    store.notifications[idx].read = true;
    setStoreItem('NOTIFICATIONS', store.notifications);
    return true;
  }
  return false;
}

/**
 * Mark all notifications as read for current workspace
 * In Supabase: await supabase.from('notifications').update({ read: true }).eq('company_id', companyId);
 */
export async function markAllNotificationsAsRead(companyId: string): Promise<boolean> {
  const store = getStore();
  store.notifications = store.notifications.map((n) =>
    n.company_id === companyId ? { ...n, read: true } : n
  );
  setStoreItem('NOTIFICATIONS', store.notifications);
  return true;
}
