import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";
import { ConfirmDialog, KVRow, TokenAmount } from "./components";

const listCategoriesTool: ToolConfig = {
  name: "list_categories",
  description: "List all transaction categories (global + user-created).",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/categories");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const createCategoryTool = defineTool({
  name: "create_category",
  description: "Create a custom transaction category.",
  inputSchema: z.object({
    name: z.string().describe("Category name"),
    description: z.string().optional().describe("Category description"),
  }),
  displayPropsSchema: z.object({ name: z.string(), description: z.string().optional() }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const data = await callApi("/categories", { method: "POST", body: input });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Create Category" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Name" value={props.name} />
        {props.description && <KVRow label="Description" value={props.description} />}
      </ConfirmDialog>
    );
  },
});

const listLimitsTool: ToolConfig = {
  name: "list_category_limits",
  description: "List all spending limits set on categories.",
  inputSchema: z.object({}),
  async do() {
    try {
      const data = await callApi("/categories/limits");
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

const setCategoryLimitTool = defineTool({
  name: "set_category_limit",
  description: "Set a monthly spending limit on a category.",
  inputSchema: z.object({
    categoryId: z.string().describe("Category ID"),
    monthlyLimit: z.string().describe("Monthly limit in base units"),
    tokenAddress: z.string().describe("Token contract address"),
    tokenSymbol: z.string().describe("Token symbol (e.g. USDC)"),
    tokenDecimals: z.number().describe("Token decimals (e.g. 6)"),
  }),
  displayPropsSchema: z.object({
    categoryId: z.string(),
    monthlyLimit: z.string(),
    tokenSymbol: z.string(),
    tokenDecimals: z.number(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait(input);
    if (!confirmed) return { status: "success", data: "Cancelled." };
    try {
      const { categoryId, ...body } = input;
      const data = await callApi(`/categories/${categoryId}/limit`, { method: "PUT", body });
      return { status: "success", data: JSON.stringify(data), renderData: data };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog title="Set Spending Limit" onConfirm={() => resolve(true)} onCancel={() => resolve(false)}>
        <KVRow label="Limit" value={<TokenAmount amount={props.monthlyLimit} symbol={props.tokenSymbol} decimals={props.tokenDecimals} />} />
        <KVRow label="Period" value="Monthly" />
      </ConfirmDialog>
    );
  },
});

export const categoryTools: ToolConfig[] = [listCategoriesTool, createCategoryTool, listLimitsTool, setCategoryLimitTool];
