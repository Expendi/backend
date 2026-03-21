import type { ToolConfig } from "glove-react";
import { z } from "zod";
import { callApi } from "./api";

interface MarketBriefResponse {
  overview: {
    totalMarketCap: number;
    totalVolume24h: number;
    btcDominance: number;
    marketCapChangePercentage24h: number;
  };
  trending: Array<{
    id: string;
    symbol: string;
    name: string;
    marketCapRank: number;
    priceChange24h: number;
  }>;
  watchlistPrices: Array<{
    symbol: string;
    price: number;
    percentChange24h: number;
    marketCap: number;
    volume24h: number;
  }>;
  generatedAt: string;
}

interface OpportunityResponse {
  token: {
    id: string;
    symbol: string;
    name: string;
    marketCapRank: number;
    priceChange24h: number;
  };
  reason: string;
  riskLevel: "low" | "medium" | "high";
  relevanceScore: number;
}

interface TokenEvaluationResponse {
  symbol: string;
  price: {
    symbol: string;
    price: number;
    percentChange24h: number;
    marketCap: number;
    volume24h: number;
  };
  metadata: {
    id: string;
    symbol: string;
    name: string;
    description: string;
    categories: string[];
  };
  volatility30d: number;
  priceChange30d: number;
  evaluatedAt: string;
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function formatMarketBrief(brief: MarketBriefResponse): string {
  const lines: string[] = [];
  lines.push("## Market Overview");
  lines.push(`- Total Market Cap: ${formatCurrency(brief.overview.totalMarketCap)} (${formatPercent(brief.overview.marketCapChangePercentage24h)} 24h)`);
  lines.push(`- 24h Volume: ${formatCurrency(brief.overview.totalVolume24h)}`);
  lines.push(`- BTC Dominance: ${brief.overview.btcDominance.toFixed(1)}%`);

  if (brief.watchlistPrices.length > 0) {
    lines.push("\n## Watchlist");
    for (const p of brief.watchlistPrices) {
      lines.push(`- ${p.symbol}: $${p.price.toLocaleString("en-US", { maximumFractionDigits: 6 })} (${formatPercent(p.percentChange24h)})`);
    }
  }

  if (brief.trending.length > 0) {
    lines.push("\n## Trending");
    for (const t of brief.trending.slice(0, 7)) {
      lines.push(`- ${t.name} (${t.symbol.toUpperCase()}): ${formatPercent(t.priceChange24h)} | Rank #${t.marketCapRank || "N/A"}`);
    }
  }

  return lines.join("\n");
}

function formatOpportunities(opportunities: OpportunityResponse[]): string {
  if (opportunities.length === 0) {
    return "No opportunities matching your profile were found at this time.";
  }

  const lines: string[] = ["## Opportunities"];
  for (const opp of opportunities) {
    const riskBadge =
      opp.riskLevel === "low"
        ? "[Low Risk]"
        : opp.riskLevel === "medium"
          ? "[Medium Risk]"
          : "[High Risk]";

    lines.push(
      `\n### ${opp.token.name} (${opp.token.symbol.toUpperCase()}) ${riskBadge}`
    );
    lines.push(`- 24h Change: ${formatPercent(opp.token.priceChange24h)}`);
    lines.push(`- Relevance Score: ${opp.relevanceScore}/100`);
    lines.push(`- ${opp.reason}`);
  }

  return lines.join("\n");
}

function formatTokenEvaluation(evaluation: TokenEvaluationResponse): string {
  const lines: string[] = [];
  lines.push(`## ${evaluation.metadata.name} (${evaluation.symbol})`);
  lines.push(`\n### Price`);
  lines.push(`- Current: $${evaluation.price.price.toLocaleString("en-US", { maximumFractionDigits: 6 })}`);
  lines.push(`- 24h Change: ${formatPercent(evaluation.price.percentChange24h)}`);
  lines.push(`- 30d Change: ${formatPercent(evaluation.priceChange30d)}`);
  lines.push(`- Market Cap: ${formatCurrency(evaluation.price.marketCap)}`);
  lines.push(`- 24h Volume: ${formatCurrency(evaluation.price.volume24h)}`);

  lines.push(`\n### Risk Metrics`);
  lines.push(`- 30d Annualized Volatility: ${(evaluation.volatility30d * 100).toFixed(1)}%`);

  if (evaluation.metadata.categories.length > 0) {
    lines.push(`\n### Categories`);
    lines.push(evaluation.metadata.categories.join(", "));
  }

  if (evaluation.metadata.description) {
    const desc = evaluation.metadata.description;
    const truncated = desc.length > 300 ? desc.slice(0, 300) + "..." : desc;
    lines.push(`\n### About`);
    lines.push(truncated);
  }

  return lines.join("\n");
}

export const researchTool: ToolConfig = {
  name: "research",
  description:
    "Research crypto markets, analyze tokens, and find opportunities based on user interests and risk profile.",
  inputSchema: z.object({
    action: z
      .enum(["market_brief", "opportunities", "token_analysis"])
      .describe(
        "'market_brief' for market overview + trending, 'opportunities' for personalized suggestions, 'token_analysis' for deep dive on a specific token"
      ),
    token: z
      .string()
      .optional()
      .describe(
        "Token symbol for token_analysis action (e.g. 'ETH', 'USDC')"
      ),
  }),
  async do(input) {
    try {
      switch (input.action) {
        case "market_brief": {
          const brief = await callApi<MarketBriefResponse>(
            "/agent/research/brief"
          );
          return {
            status: "success" as const,
            data: formatMarketBrief(brief),
            renderData: brief,
          };
        }
        case "opportunities": {
          const opportunities = await callApi<OpportunityResponse[]>(
            "/agent/research/opportunities"
          );
          return {
            status: "success" as const,
            data: formatOpportunities(opportunities),
            renderData: opportunities,
          };
        }
        case "token_analysis": {
          if (!input.token || input.token.trim().length === 0) {
            return {
              status: "error" as const,
              data: "",
              message:
                "Token symbol is required for token_analysis. Please specify which token to analyze (e.g. 'ETH', 'BTC', 'USDC').",
            };
          }

          const evaluation = await callApi<TokenEvaluationResponse>(
            `/agent/research/token/${encodeURIComponent(input.token.trim().toUpperCase())}`
          );
          return {
            status: "success" as const,
            data: formatTokenEvaluation(evaluation),
            renderData: evaluation,
          };
        }
        default: {
          return {
            status: "error" as const,
            data: "",
            message: `Unknown action: ${input.action}. Use 'market_brief', 'opportunities', or 'token_analysis'.`,
          };
        }
      }
    } catch (e) {
      return {
        status: "error" as const,
        data: "",
        message: `Research failed: ${String(e)}`,
      };
    }
  },
};
