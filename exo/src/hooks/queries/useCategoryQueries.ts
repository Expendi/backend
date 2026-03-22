import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useApi } from "../useApi";
import { queryKeys } from "../../lib/query-client";
import type { Category, CategoryLimit } from "../../lib/types";

export function useCategoriesQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: async () => {
      const raw = await request<(Omit<Category, "isGlobal"> & { userId: string | null })[]>("/categories");
      return raw.map((c) => ({ ...c, isGlobal: c.userId === null }));
    },
  });
}

export function useCategoryLimitsQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.categoryLimits,
    queryFn: () => request<CategoryLimit[]>("/categories/limits"),
  });
}

export function useSpendingQuery() {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.spending,
    queryFn: () =>
      request<
        {
          categoryId: string;
          categoryName: string;
          txCount: number;
          totalSpent: string;
          limit: { monthlyLimit: string; tokenSymbol: string; tokenDecimals: number } | null;
        }[]
      >("/categories/spending"),
  });
}

export function useDailySpendingQuery(days = 30) {
  const { request } = useApi();

  return useQuery({
    queryKey: queryKeys.dailySpending(days),
    queryFn: () =>
      request<
        {
          date: string;
          categoryId: string;
          categoryName: string;
          totalAmount: string;
          txCount: number;
        }[]
      >("/categories/spending/daily", { query: { days: String(days) } }),
  });
}

export function useCreateCategoryMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      monthlyLimit?: string;
    }) => {
      const body: Record<string, string> = { name: data.name };
      if (data.description) body.description = data.description;

      const created = await request<{ id: string }>("/categories", {
        method: "POST",
        body,
      });

      if (data.monthlyLimit && parseFloat(data.monthlyLimit) > 0) {
        const rawLimit = Math.round(parseFloat(data.monthlyLimit) * 1e6).toString();
        await request(`/categories/${created.id}/limit`, {
          method: "PUT",
          body: {
            monthlyLimit: rawLimit,
            tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            tokenSymbol: "USDC",
            tokenDecimals: 6,
          },
        });
      }

      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      queryClient.invalidateQueries({ queryKey: queryKeys.categoryLimits });
    },
  });
}

export function useUpdateCategoryMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      id: string;
      name?: string;
      description?: string;
      monthlyLimit?: string;
      existingLimit?: CategoryLimit | null;
    }) => {
      const body: Record<string, string> = {};
      if (data.name) body.name = data.name;
      if (data.description !== undefined) body.description = data.description;

      if (Object.keys(body).length > 0) {
        await request(`/categories/${data.id}`, { method: "PUT", body });
      }

      // Handle limit updates
      const existingLimitHuman = data.existingLimit
        ? (
            Number(data.existingLimit.monthlyLimit) /
            Math.pow(10, data.existingLimit.tokenDecimals)
          ).toString()
        : "";

      if (data.monthlyLimit !== undefined && data.monthlyLimit !== existingLimitHuman) {
        if (data.monthlyLimit && parseFloat(data.monthlyLimit) > 0) {
          const rawLimit = Math.round(parseFloat(data.monthlyLimit) * 1e6).toString();
          await request(`/categories/${data.id}/limit`, {
            method: "PUT",
            body: {
              monthlyLimit: rawLimit,
              tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
              tokenSymbol: "USDC",
              tokenDecimals: 6,
            },
          });
        } else if (!data.monthlyLimit && data.existingLimit) {
          await request(`/categories/${data.id}/limit`, {
            method: "DELETE",
            query: { tokenAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      queryClient.invalidateQueries({ queryKey: queryKeys.categoryLimits });
    },
  });
}

export function useDeleteCategoryMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      request(`/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
    },
  });
}

export function useBatchCreateCategoriesMutation() {
  const { request } = useApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (categories: { name: string; description: string }[]) =>
      request<Category[]>("/categories/batch", {
        method: "POST",
        body: categories,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      queryClient.invalidateQueries({ queryKey: queryKeys.categoryLimits });
    },
  });
}
