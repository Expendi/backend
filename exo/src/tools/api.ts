/**
 * Shared authenticated API fetcher used by all Glove tools.
 *
 * The fetcher is injected at runtime from ChatPage via setApiFetcher()
 * so that every tool call carries the user's Privy auth token.
 *
 * When a mutating request receives a TransactionApprovalRequired error,
 * the approval handler (registered via setApprovalHandler) is invoked to
 * prompt the user for their PIN. The resulting token is cached and the
 * request is automatically retried.
 */

import { ApiRequestError } from "../hooks/useApi";

type ApiFetcherFn = <T>(path: string, opts?: {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  approvalToken?: string | null;
  query?: Record<string, string | number | undefined>;
}) => Promise<T>;

/**
 * Callback that prompts the user for approval and returns a valid
 * approval token. The handler receives the approval method ("pin" or
 * "passkey") so it can render the appropriate UI. Returns null if
 * the user cancels.
 */
type ApprovalHandlerFn = (method: string) => Promise<string | null>;

let apiFetcher: ApiFetcherFn | null = null;
let approvalHandler: ApprovalHandlerFn | null = null;

export function setApiFetcher(fn: ApiFetcherFn) {
  apiFetcher = fn;
}

export function setApprovalHandler(fn: ApprovalHandlerFn) {
  approvalHandler = fn;
}

export async function callApi<T = unknown>(
  path: string,
  opts?: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  },
): Promise<T> {
  if (!apiFetcher) throw new Error("API fetcher not initialized");

  try {
    return await apiFetcher<T>(path, opts);
  } catch (err) {
    // If the error is a TransactionApprovalRequired, prompt for approval and retry
    if (
      err instanceof ApiRequestError &&
      err._tag === "TransactionApprovalRequired" &&
      approvalHandler
    ) {
      const method = err.method ?? "pin";
      const token = await approvalHandler(method);
      if (!token) throw new Error("Transaction approval was cancelled");

      // Retry with the approval token
      return apiFetcher<T>(path, { ...opts, approvalToken: token });
    }

    throw err;
  }
}

/** Wrap a callApi invocation into a ToolResultData */
export async function apiToolResult<T = unknown>(
  path: string,
  opts?: {
    method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
    body?: unknown;
    query?: Record<string, string | number | undefined>;
  },
): Promise<{ status: "success" | "error"; data: string; message?: string; renderData?: T }> {
  try {
    const data = await callApi<T>(path, opts);
    return { status: "success", data: JSON.stringify(data), renderData: data };
  } catch (e) {
    return { status: "error", data: "", message: String(e) };
  }
}
