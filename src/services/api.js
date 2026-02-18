// src/services/api.js
import { Platform } from "react-native";

// IP جهازك من ipconfig
const DEV_LAN_IP = "192.168.100.152";
const PORT = 4000;

// base url للـ API
export const API_BASE_URL = `http://${DEV_LAN_IP}:${PORT}/api`;

// origin لعرض الصور /uploads
export const API_ORIGIN = `http://${DEV_LAN_IP}:${PORT}`;

// helper
export async function apiFetch(path, options = {}) {
  const url = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}
