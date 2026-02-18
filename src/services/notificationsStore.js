// src/services/notificationsStore.js
import AsyncStorage from "@react-native-async-storage/async-storage";

const NOTIF_KEY = "local_notifications_v1";

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export async function getNotifications() {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export async function addNotification({ title, body, reportId = null, route = null, params = null }) {
  const list = await getNotifications();

  const item = {
    id: uid(),
    title: String(title ?? ""),
    body: String(body ?? ""),
    reportId,
    route,   // مثال: "MyReports" أو "ReportDetails" لاحقًا
    params,  // مثال: { reportId }
    read: false,
    createdAt: Date.now(),
  };

  const next = [item, ...list].slice(0, 100); // حد أقصى 100
  await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
  return item;
}

export async function markAllRead() {
  const list = await getNotifications();
  const next = list.map((n) => ({ ...n, read: true }));
  await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
  return next;
}

export async function markRead(id) {
  const list = await getNotifications();
  const next = list.map((n) => (n.id === id ? { ...n, read: true } : n));
  await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
  return next;
}

export async function removeNotification(id) {
  const list = await getNotifications();
  const next = list.filter((n) => n.id !== id);
  await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
  return next;
}

export async function clearNotifications() {
  await AsyncStorage.removeItem(NOTIF_KEY);
  return [];
}

export async function getUnreadCount() {
  const list = await getNotifications();
  return list.filter((n) => !n.read).length;
}
