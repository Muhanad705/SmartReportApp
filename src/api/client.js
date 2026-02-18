// src/api/client.js
import Constants from "expo-constants";
import { Platform } from "react-native";

const FALLBACK = "http://10.60.34.74:4000"; // IP اللابتوب حقك ✅
export const API_BASE =
  Constants?.expoConfig?.extra?.API_BASE ||
  Constants?.manifest?.extra?.API_BASE || // احتياط
  FALLBACK;

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.message || "Request failed");
  return data;
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.message || "Request failed");
  return data;
}

export async function apiUploadSingle(fileUri) {
  const form = new FormData();
  const uri = fileUri;

  // استخراج اسم/نوع مبسط
  const name = uri.split("/").pop() || `file_${Date.now()}`;
  const ext = (name.split(".").pop() || "").toLowerCase();
  const type = ext === "mp4" ? "video/mp4" : ext === "mov" ? "video/quicktime" : "image/jpeg";

  form.append("file", {
    uri,
    name,
    type,
  });

  const res = await fetch(`${API_BASE}/api/uploads/single`, {
    method: "POST",
    body: form,
    headers: {
      // لا تحط Content-Type يدوي مع FormData في RN
    },
  });

  const data = await safeJson(res);
  if (!res.ok) throw new Error(data?.message || "Upload failed");
  return data; // {fileUrl, type}
}
