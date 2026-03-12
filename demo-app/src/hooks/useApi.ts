import { useCallback } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { apiRequest } from "../lib/api";
import type { ApiError as ApiErrorType } from "../lib/types";

/**
 * Custom error class that preserves the API error tag and any extra
 * fields (e.g. `method` for TransactionApprovalRequired).
 */
export class ApiRequestError extends Error {
  readonly _tag: string;
  readonly method?: string;

  constructor(error: ApiErrorType) {
    super(`${error._tag}: ${error.message}`);
    this.name = "ApiRequestError";
    this._tag = error._tag;
    this.method = error.method;
  }
}

export function useApi() {
  const { getAccessToken } = usePrivy();

  const request = useCallback(
    async <T>(
      path: string,
      options?: {
        method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
        body?: unknown;
        approvalToken?: string | null;
        query?: Record<string, string | number | undefined>;
      }
    ): Promise<T> => {
      const accessToken = await getAccessToken();
      const result = await apiRequest<T>(path, {
        ...options,
        accessToken,
      });

      if (!result.success) {
        throw new ApiRequestError(result.error);
      }

      return result.data;
    },
    [getAccessToken]
  );

  const requestRaw = useCallback(
    async <T>(
      path: string,
      options?: {
        method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
        body?: unknown;
        approvalToken?: string | null;
        query?: Record<string, string | number | undefined>;
      }
    ) => {
      const accessToken = await getAccessToken();
      return apiRequest<T>(path, {
        ...options,
        accessToken,
      });
    },
    [getAccessToken]
  );

  return { request, requestRaw };
}
