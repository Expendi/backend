import { defineTool } from "glove-react";
import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { apiToolResult, callApi } from "./api";
import {
  ConfirmDialog,
} from "./components";

// ─── get_profile ────────────────────────────────────────────────────────────

const getProfileTool: ToolConfig = {
  name: "get_profile",
  description:
    "Get the current user's profile including username, user ID, and wallet addresses. Only call this when the user explicitly asks about their profile or account details. Do NOT call this to get wallet IDs for transactions — use wallet types (user/server/agent) instead.",
  inputSchema: z.object({}),
  async do() {
    return apiToolResult("/profile");
  },
};

// ─── onboard_user ───────────────────────────────────────────────────────────

const onboardUserTool = defineTool({
  name: "onboard_user",
  description:
    "Create a new user profile and wallets. Use when the user wants to sign up or create their account.",
  inputSchema: z.object({
    chainId: z
      .number()
      .optional()
      .describe("Blockchain chain ID (default: Base 8453)"),
  }),
  displayPropsSchema: z.object({
    chainId: z.number().optional(),
  }),
  resolveSchema: z.boolean(),
  displayStrategy: "hide-on-complete" as const,
  async do(input, display) {
    const confirmed = await display.pushAndWait({ chainId: input.chainId });
    if (!confirmed) {
      return { status: "success", data: "User cancelled onboarding." };
    }
    try {
      const result = await callApi("/onboard", {
        method: "POST",
        body: input,
      });
      return {
        status: "success",
        data: JSON.stringify(result),
        renderData: result,
      };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
  render({ props, resolve }) {
    return (
      <ConfirmDialog
        title="Onboard New Profile"
        onConfirm={() => resolve(true)}
        onCancel={() => resolve(false)}
      >
        <p>
          Create new profile and 3 wallets on{" "}
          {props.chainId ? `chain ${props.chainId}` : "Base"}?
        </p>
      </ConfirmDialog>
    );
  },
});

// ─── set_username ───────────────────────────────────────────────────────────

const setUsernameTool: ToolConfig = {
  name: "set_username",
  description: "Set or update the user's username.",
  inputSchema: z.object({
    username: z.string().describe("The desired username"),
  }),
  async do(input) {
    try {
      const result = await callApi("/profile/username", {
        method: "PUT",
        body: input,
      });
      return {
        status: "success",
        data: JSON.stringify(result),
        renderData: result,
      };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── resolve_username ───────────────────────────────────────────────────────

const resolveUsernameTool: ToolConfig = {
  name: "resolve_username",
  description: "Look up a user by their username to find their address.",
  inputSchema: z.object({
    username: z.string().describe("The username to look up"),
  }),
  async do(input) {
    try {
      const result = await callApi(`/profile/resolve/${input.username}`);
      return {
        status: "success",
        data: JSON.stringify(result),
        renderData: result,
      };
    } catch (e) {
      return { status: "error", data: "", message: String(e) };
    }
  },
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const profileTools: ToolConfig[] = [
  getProfileTool,
  onboardUserTool,
  setUsernameTool,
  resolveUsernameTool,
];
