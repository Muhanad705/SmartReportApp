// src/services/managerApi.js
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiFetch } from "./api";

const SESSION_KEY = "local_session_v1";

async function getToken() {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return "";
  try {
    const s = JSON.parse(raw);
    return s?.token || "";
  } catch {
    return "";
  }
}

async function request(path, options = {}) {
  const token = await getToken();

  const { res, data } = await apiFetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    const msg = data?.message || data?.raw || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

export const managerApi = {
  stats: () => request("/manager/stats"),
  reports: (status = "") =>
    request(`/manager/reports${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  reportDetails: (id) => request(`/manager/reports/${id}`),
};