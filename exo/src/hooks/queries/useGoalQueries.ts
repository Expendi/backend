import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../useApi";
import { queryKeys } from "../../lib/query-client";
import type { GoalSaving } from "../../lib/types";

export function useGoalsQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.goals,
    queryFn: () => request<GoalSaving[]>("/goal-savings"),
  });
}

export function useGoalQuery(id: string) {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.goal(id),
    queryFn: () => request<GoalSaving>(`/goal-savings/${id}`),
    enabled: !!id,
  });
}

export function useCreateGoalMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request("/goal-savings", { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals });
    },
  });
}

export function useUpdateGoalMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      request(`/goal-savings/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals });
    },
  });
}

export function useGoalDepositMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ goalId, ...body }: { goalId: string } & Record<string, unknown>) =>
      request(`/goal-savings/${goalId}/deposit`, { method: "POST", body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals });
    },
  });
}

export function useGoalActionMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" | "cancel" }) =>
      request(`/goal-savings/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.goals });
    },
  });
}
