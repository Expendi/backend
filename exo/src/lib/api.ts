import type { ApiResult } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export async function apiRequest<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    body?: unknown;
    accessToken: string | null;
    approvalToken?: string | null;
    query?: Record<string, string | number | undefined>;
  }
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.accessToken) {
    headers["Authorization"] = `Bearer ${options.accessToken}`;
  }

  if (options.approvalToken) {
    headers["X-Approval-Token"] = options.approvalToken;
  }

  let url = `${API_BASE}/api${path}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    return { success: false, error: { _tag: "Unauthorized", message: "Access token expired or invalid" } };
  }

  if (res.status === 403) {
    try {
      const body = await res.json();
      if (body?.error?._tag) {
        return { success: false, error: body.error };
      }
    } catch {
      // If we can't parse the body, fall through to generic error
    }
    return { success: false, error: { _tag: "Forbidden", message: "Insufficient permissions" } };
  }

  const json = await res.json();
  return json as ApiResult<T>;
}
