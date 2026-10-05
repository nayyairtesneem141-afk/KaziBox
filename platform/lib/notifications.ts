import { NotificationItem, NotificationType } from '@kazibox/sdk';
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

/**
 * Generic dispatch helper for in-app notifications
 */
export async function createNotification(params: {
  companyId: string;
  title: string;
  message: string;
  type: NotificationType;
  link?: string;
}): Promise<NotificationItem> {
  const store = getStore();
  const newNotif: NotificationItem = {
    id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    company_id: params.companyId,
    title: params.title,
    message: params.message,
    type: params.type,
    read: false,
    created_at: new Date().toISOString(),
    link: params.link,
  };

  store.notifications.unshift(newNotif);
  setStoreItem('NOTIFICATIONS', store.notifications);
  return newNotif;
}

/**
 * In-app Notification: Module Activated
 */
export async function notifyModuleActivated(companyId: string, moduleName: string) {
  return createNotification({
    companyId,
    title: `Module activé : ${moduleName}`,
    message: `Le module ${moduleName} a été activé avec succès sur votre espace de travail.`,
    type: 'success',
    link: '/modules/my-modules',
  });
}

/**
 * In-app Notification: Module Deactivated
 * Includes data retention notice: "Your data is kept for 30 days"
 */
export async function notifyModuleDeactivated(companyId: string, moduleName: string) {
  return createNotification({
    companyId,
    title: `Module désactivé : ${moduleName}`,
    message: `Le module ${moduleName} a été désactivé. Vos données sont conservées pendant 30 jours.`,
    type: 'warning',
    link: '/modules/catalogue',
  });
}

/**
 * In-app Notification: Subscription Activated
 */
export async function notifySubscriptionActivated(companyId: string, planName: string) {
  return createNotification({
    companyId,
    title: `Abonnement activé : ${planName}`,
    message: `Votre abonnement ${planName} est désormais actif pour l’ensemble de vos modules sélectionnés.`,
    type: 'success',
    link: '/billing',
  });
}

/**
 * In-app Notification: Subscription Expiring in 7 Days
 */
export async function notifySubscriptionExpiring(companyId: string, daysRemaining = 7) {
  return createNotification({
    companyId,
    title: `Abonnement expirant bientôt`,
    message: `Votre abonnement arrive à échéance dans ${daysRemaining} jours. Pensez à le renouveler pour maintenir vos modules actifs.`,
    type: 'warning',
    link: '/billing',
  });
}

/**
 * In-app Notification: Payment Failed
 */
export async function notifyPaymentFailed(companyId: string, amount = '15 000 XOF') {
  return createNotification({
    companyId,
    title: `Échec du prélèvement d'abonnement`,
    message: `La tentative de paiement de ${amount} a échoué. Veuillez vérifier votre moyen de paiement Mobile Money ou carte bancaire.`,
    type: 'alert',
    link: '/billing',
  });
}
