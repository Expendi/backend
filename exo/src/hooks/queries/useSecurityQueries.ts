import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../useApi";
import { queryKeys } from "../../lib/query-client";
import type { ApprovalSettings, Passkey } from "../../lib/types";

export function useApprovalSettingsQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.approvalSettings,
    queryFn: () => request<ApprovalSettings>("/security/approval"),
  });
}

export function usePasskeysQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.passkeys,
    queryFn: () => request<Passkey[]>("/security/approval/passkeys"),
  });
}

export function useSetupPinMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pin: string) =>
      request("/security/approval/pin/setup", {
        method: "POST",
        body: { pin },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvalSettings });
    },
  });
}

export function useChangePinMutation() {
  const { request } = useApi();

  return useMutation({
    mutationFn: (data: { currentPin: string; newPin: string }) =>
      request("/security/approval/pin/change", {
        method: "POST",
        body: data,
      }),
  });
}

export function useRemovePinMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pin: string) =>
      request("/security/approval/pin", {
        method: "DELETE",
        body: { pin },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvalSettings });
    },
  });
}

export function useRemovePasskeyMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      request(`/security/approval/passkeys/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.passkeys });
    },
  });
}

export function useDisableApprovalMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pin?: string) =>
      request("/security/approval", {
        method: "DELETE",
        body: pin ? { pin } : {},
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.approvalSettings });
    },
  });
}
