import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { createChatRoutes } from "../../routes/chat.js";
import type { AuthVariables } from "../../middleware/auth.js";

// Mock glove-core before imports
vi.mock("glove-core/models/providers", () => ({
  providers: {} as Record<string, any>,
  createAdapter: vi.fn(),
}));

import { createAdapter, providers } from "glove-core/models/providers";

const TEST_USER_ID = "did:privy:test-user-chat";

const mockAdapter = {
  setSystemPrompt: vi.fn(),
  prompt: vi.fn(),
};

function makeApp() {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", TEST_USER_ID);
    await next();
  });
  app.route("/", createChatRoutes());
  return app;
}

describe("Chat Routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset providers to empty
    for (const key of Object.keys(providers)) {
      delete providers[key];
    }
    (createAdapter as ReturnType<typeof vi.fn>).mockReturnValue(mockAdapter);
    mockAdapter.setSystemPrompt.mockReset();
    mockAdapter.prompt.mockReset();
  });

  describe("POST /", () => {
    it("should stream text deltas and a done event on success", async () => {
      mockAdapter.prompt.mockImplementation(async (req: any, callback: any) => {
        await callback("text_delta", { text: "Hello " });
        await callback("text_delta", { text: "World" });
        return {
          messages: [{ sender: "agent", text: "Hello World" }],
          tokens_in: 10,
          tokens_out: 5,
        };
      });

      const app = makeApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: "You are a helpful assistant.",
          messages: [{ sender: "user", text: "Hi" }],
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");

      const text = await res.text();

      // Verify SSE text_delta events
      expect(text).toContain(
        JSON.stringify({ type: "text_delta", text: "Hello " }),
      );
      expect(text).toContain(
        JSON.stringify({ type: "text_delta", text: "World" }),
      );

      // Verify done event
      expect(text).toContain(
        JSON.stringify({
          type: "done",
          message: { sender: "agent", text: "Hello World" },
          tokens_in: 10,
          tokens_out: 5,
        }),
      );

      // Verify system prompt was set (hardcoded default, since no profile is loaded in tests)
      expect(mockAdapter.setSystemPrompt).toHaveBeenCalledWith(
        "You are exo, a helpful financial assistant.",
      );

      // Verify prompt was called with correct messages
      expect(mockAdapter.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ sender: "user", text: "Hi" }],
        }),
        expect.any(Function),
      );
    });

    it("should stream tool_use events when tools are used", async () => {
      mockAdapter.prompt.mockImplementation(async (req: any, callback: any) => {
        await callback("tool_use", {
          id: "tool-1",
          name: "get_balance",
          input: { address: "0x123" },
        });
        return {
          messages: [{ sender: "agent", text: "" }],
          tokens_in: 15,
          tokens_out: 8,
        };
      });

      const app = makeApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: "You are an assistant.",
          messages: [{ sender: "user", text: "Check my balance" }],
          tools: [
            {
              name: "get_balance",
              description: "Get wallet balance",
              parameters: {
                type: "object",
                properties: {
                  address: { type: "string" },
                },
                required: ["address"],
              },
            },
          ],
        }),
      });

      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain(
        JSON.stringify({
          type: "tool_use",
          id: "tool-1",
          name: "get_balance",
          input: { address: "0x123" },
        }),
      );

      // Verify tools were passed to prompt
      expect(mockAdapter.prompt).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.arrayContaining([
            expect.objectContaining({
              name: "get_balance",
              description: "Get wallet balance",
            }),
          ]),
        }),
        expect.any(Function),
      );
    });

    it("should return 500 when adapter creation fails", async () => {
      (createAdapter as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Invalid API key");
      });

      const app = makeApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: "You are a helpful assistant.",
          messages: [{ sender: "user", text: "Hi" }],
        }),
      });

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("Failed to create model adapter");
      expect(body.error).toContain("Invalid API key");
    });

    it("should stream an error done event when prompt throws", async () => {
      mockAdapter.prompt.mockRejectedValue(new Error("Stream failed"));

      const app = makeApp();
      const res = await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: "You are a helpful assistant.",
          messages: [{ sender: "user", text: "Hi" }],
        }),
      });

      expect(res.status).toBe(200);

      const text = await res.text();
      // The route now emits a dedicated error event + a done event
      expect(text).toContain('"type":"error"');
      expect(text).toContain('"detail":"Stream failed"');
      expect(text).toContain('"type":"done"');
    });

    it("should use hardcoded default system prompt when client sends empty prompt", async () => {
      mockAdapter.prompt.mockImplementation(async () => ({
        messages: [{ sender: "agent", text: "ok" }],
        tokens_in: 1,
        tokens_out: 1,
      }));

      const app = makeApp();
      await app.request("/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: "",
          messages: [{ sender: "user", text: "Hi" }],
        }),
      });

      expect(mockAdapter.setSystemPrompt).toHaveBeenCalledWith(
        "You are exo, a helpful financial assistant.",
      );
    });
  });
});
