/** Shared fetch helpers for the PDF Studio pages. */

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function errorMessage(response) {
  try {
    const payload = await response.json();
    if (payload?.detail) {
      return typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload.detail);
    }
  } catch {
    /* fall through to text */
  }
  try {
    const text = await response.text();
    if (text) return text;
  } catch {
    /* ignore */
  }
  return `Request failed (${response.status}).`;
}

/**
 * Fetch JSON from the API. JSON bodies get a content type automatically;
 * FormData bodies are left untouched so the browser sets the boundary.
 */
export async function api(path, { csrf = "", method = "GET", body, form, signal } = {}) {
  const headers = new Headers();
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  if (method !== "GET" && method !== "HEAD") {
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const response = await fetch(path, {
    method,
    headers,
    body: payload,
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new ApiError(await errorMessage(response), response.status);
  if (response.status === 204) return null;
  return response.json();
}

export async function csrfToken() {
  const response = await fetch("/api/auth/csrf", { credentials: "include", cache: "no-store" });
  if (!response.ok) return "";
  const payload = await response.json();
  return payload.csrf_token || "";
}

export async function currentUser() {
  const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.user || null;
}

export function formatBytes(value) {
  const size = Number(value) || 0;
  if (!size) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(size) / Math.log(1024)));
  return `${(size / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function downloadUrl(docId, kind = "download", format = "") {
  if (kind === "export") return `/api/pdf/${docId}/export?format=${encodeURIComponent(format)}`;
  return `/api/pdf/${docId}/download`;
}
