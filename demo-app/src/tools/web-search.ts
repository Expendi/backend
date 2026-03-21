import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";

interface SearchResultResponse {
  url: string;
  title: string;
  publishDate: string | null;
  excerpts: string[];
}

interface SearchResponse {
  searchId: string;
  results: SearchResultResponse[];
  searchedAt: string;
}

interface ResearchResponse {
  topic: string;
  results: SearchResultResponse[];
  searchedAt: string;
}

function formatSearchResults(results: SearchResultResponse[]): string {
  if (results.length === 0) {
    return "No results found for this search.";
  }

  const lines: string[] = ["## Search Results\n"];

  for (const result of results) {
    lines.push(`### ${result.title}`);

    if (result.publishDate) {
      const date = new Date(result.publishDate);
      const formatted = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      lines.push(`*Published: ${formatted}*`);
    }

    if (result.excerpts.length > 0) {
      const excerpt = result.excerpts[0]!;
      const truncated =
        excerpt.length > 300 ? excerpt.slice(0, 300) + "..." : excerpt;
      lines.push(truncated);
    }

    lines.push(`[Source](${result.url})\n`);
  }

  return lines.join("\n");
}

function formatResearchBrief(response: ResearchResponse): string {
  if (response.results.length === 0) {
    return `No information found about "${response.topic}".`;
  }

  const lines: string[] = [`## Research: ${response.topic}\n`];

  for (const result of response.results) {
    lines.push(`### ${result.title}`);

    if (result.publishDate) {
      const date = new Date(result.publishDate);
      const formatted = date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      lines.push(`*Published: ${formatted}*`);
    }

    if (result.excerpts.length > 0) {
      for (const excerpt of result.excerpts.slice(0, 2)) {
        const truncated =
          excerpt.length > 400 ? excerpt.slice(0, 400) + "..." : excerpt;
        lines.push(truncated);
      }
    }

    lines.push(`[Source](${result.url})\n`);
  }

  return lines.join("\n");
}

export const webSearchTool: ToolConfig = {
  name: "web_search",
  description:
    "Search the web for current information about crypto, tokens, protocols, news, and market trends. Use this to answer questions about current events or look up specific information.",
  inputSchema: z.object({
    action: z
      .enum(["search", "research"])
      .describe(
        "'search' for a quick web search, 'research' for deeper topic research with multiple queries"
      ),
    query: z
      .string()
      .describe(
        "The search query or research topic"
      ),
    objective: z
      .string()
      .optional()
      .describe(
        "Optional higher-level objective describing what you want to learn (used with 'search' action)"
      ),
  }),
  async do(input) {
    try {
      switch (input.action) {
        case "search": {
          const body: { query?: string; objective?: string; queries?: string[] } = {
            query: input.query,
          };
          if (input.objective) {
            body.objective = input.objective;
            body.queries = [input.query];
          }

          const response = await callApi<SearchResponse>(
            "/agent/search/search",
            { method: "POST", body }
          );
          return {
            status: "success" as const,
            data: formatSearchResults(response.results),
            renderData: response,
          };
        }
        case "research": {
          const response = await callApi<ResearchResponse>(
            "/agent/search/research",
            { method: "POST", body: { topic: input.query } }
          );
          return {
            status: "success" as const,
            data: formatResearchBrief(response),
            renderData: response,
          };
        }
        default: {
          return {
            status: "error" as const,
            data: "",
            message: `Unknown action: ${input.action}. Use 'search' or 'research'.`,
          };
        }
      }
    } catch (e) {
      return {
        status: "error" as const,
        data: "",
        message: `Web search failed: ${String(e)}`,
      };
    }
  },
};
