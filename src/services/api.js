// src/services/api.js
 
// IP جهازك (من ipconfig)
const DEV_LAN_IP = "192.168.100.144";
const PORT = 4000;

// base url للـ API (لاحظ /api)
export const API_BASE_URL = `http://${DEV_LAN_IP}:${PORT}/api`;

// origin لعرض الصور /uploads
export const API_ORIGIN = `http://${DEV_LAN_IP}:${PORT}`;

// helper: يرجّع { res, data } حتى لو الرد مو JSON
export async function apiFetch(path, options = {}) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE_URL}${cleanPath}`;

  const res = await fetch(url, options);

  // حاول JSON، وإذا فشل رجّع نص
  let data = {};
  try {
    data = await res.json();
  } catch {
    try {
      data = { raw: await res.text() };
    } catch {
      data = {};
    }
  }

  return { res, data };
 }