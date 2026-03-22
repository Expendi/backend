import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { usePrivy } from "@privy-io/react-auth";
import { useApi } from "../useApi";
import { queryKeys } from "../../lib/query-client";
import type { ProfileWithWallets, OnboardResult, UserPreferences } from "../../lib/types";

export function useProfileQuery() {
  const { authenticated } = usePrivy();
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.profile,
    queryFn: () => request<ProfileWithWallets>("/profile"),
    enabled: authenticated,
  });
}

export function useOnboardMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (chainId: number = 8453) =>
      request<OnboardResult>("/onboard", {
        method: "POST",
        body: { chainId },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function useUsernameMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (username: string) =>
      request("/profile/username", {
        method: "PUT",
        body: { username },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });
}

export function usePreferencesQuery() {
  const { authenticated } = usePrivy();
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.preferences,
    queryFn: () => request<UserPreferences>("/profile/preferences"),
    enabled: authenticated,
  });
}

export function usePreferencesMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Partial<UserPreferences>) =>
      request<UserPreferences>("/profile/preferences", {
        method: "PATCH",
        body: patch,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.preferences, data);
    },
  });
}
