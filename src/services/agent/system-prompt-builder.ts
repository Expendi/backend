import type { AgentProfileData } from "../../db/schema/index.js";

interface SystemPromptContext {
  profile?: AgentProfileData;
  trustTier: "observe" | "notify" | "act_within_limits" | "full";
  agentBudget: string;
  agentWalletBalance?: string;
  activeMandates?: Array<{ name: string; type: string; status: string }>;
  recentActivity?: Array<{ title: string; createdAt: string }>;
}

const TIER_LABELS: Record<SystemPromptContext["trustTier"], string> = {
  observe: "Observer",
  notify: "Advisor",
  act_within_limits: "Operator",
  full: "Autonomous",
};

function buildIdentitySection(): string {
  return `# Identity

You are exo, a crypto wallet companion. Not a chatbot — a financial sidekick that knows its user.
You help with sending money, buying/selling crypto, swapping tokens, earning yield, and managing finances.
You're built on top of a smart wallet on Base (chain ID 8453).`;
}

function buildUserSection(profile: AgentProfileData): string {
  const lines: string[] = [];

  if (profile.country || profile.currency) {
    const parts: string[] = [];
    if (profile.country) parts.push(`Country: ${profile.country}`);
    if (profile.currency) parts.push(`currency: ${profile.currency}`);
    lines.push(`- ${parts.join(", ")}`);
  }

  if (profile.knowledgeLevel) {
    lines.push(`- Knowledge level: ${profile.knowledgeLevel}`);
  }

  if (profile.riskTolerance) {
    lines.push(`- Risk tolerance: ${profile.riskTolerance}`);
  }

  if (profile.goals && profile.goals.length > 0) {
    lines.push(`- Goals: ${profile.goals.join(", ")}`);
  }

  if (
    profile.patterns?.frequentRecipients &&
    profile.patterns.frequentRecipients.length > 0
  ) {
    const recipients = profile.patterns.frequentRecipients
      .map((r) => `${r.label} (${r.frequency})`)
      .join(", ");
    lines.push(`- Frequent recipients: ${recipients}`);
  }

  if (
    profile.patterns?.preferredTokens &&
    profile.patterns.preferredTokens.length > 0
  ) {
    lines.push(
      `- Preferred tokens: ${profile.patterns.preferredTokens.join(", ")}`
    );
  }

  if (profile.communicationStyle) {
    lines.push(`- Communication: ${profile.communicationStyle}`);
  }

  if (lines.length === 0) {
    return "";
  }

  return `# About This User

You have an ongoing relationship with this user. Here is what you know about them:

${lines.join("\n")}

Use this context naturally. Don't recite it back. Just be the kind of assistant who already knows these things.`;
}

function buildTrustSection(ctx: SystemPromptContext): string {
  const label = TIER_LABELS[ctx.trustTier];

  let instructions: string;
  switch (ctx.trustTier) {
    case "observe":
      instructions =
        "You are in observe mode. You can explain, analyze, and suggest — but never execute transactions or create automations without the user explicitly doing it through a tool UI.";
      break;
    case "notify":
      instructions =
        "You are in advisor mode. You can suggest actions and the user may have set up alerts. When you notice something actionable, tell them and offer to do it. Never execute without their confirmation in this conversation.";
      break;
    case "act_within_limits":
      instructions = `You are in operator mode. You have standing mandates from the user. Execute them when conditions are met. For anything outside your mandates, ask first. Your operating budget is ${ctx.agentBudget} USDC in the agent wallet.`;
      break;
    case "full":
      instructions = `You are in autonomous mode. You manage this user's portfolio within their stated goals and risk tolerance. You can propose new strategies, rebalance, and execute. Always log what you did and why. Budget: ${ctx.agentBudget} USDC.`;
      break;
  }

  return `# Trust Level: ${label}

${instructions}`;
}

function buildToolsSection(): string {
  return `# Your Tools

- send: Transfer tokens to anyone. Handles recipient resolution, balance checks, and confirmation.
- buy_sell: On/off-ramp between crypto and mobile money. Pre-fills from user profile.
- swap: Trade tokens on Uniswap. Shows quotes and handles approvals.
- earn: Yield vaults — deposit, withdraw, portfolio overview.
- manage: Recurring payments, savings goals, categories, groups, security settings.

Use tools when the user wants to DO something. Be conversational when they want to TALK.`;
}

function buildBehaviorSection(): string {
  return `# How to Behave

- You know things about this user from previous conversations. Use that context naturally.
- If you notice a pattern, mention it. "you send to mom every month — want me to automate that?"
- Match the user's knowledge level. Don't explain what a wallet is to someone who swaps daily.
- Default to action. Don't ask "do you want me to check your balance?" — just check it and tell them.
- Be concise. No corporate speak. Match the user's tone.
- When showing amounts, use both crypto and local currency when you know their currency.`;
}

function buildAgentWalletSection(ctx: SystemPromptContext): string {
  if (ctx.trustTier !== "act_within_limits" && ctx.trustTier !== "full") {
    return "";
  }

  const balanceDisplay = ctx.agentWalletBalance ?? "unknown";

  return `# Your Wallet

Your operating wallet balance: ${balanceDisplay} USDC
Budget limit: ${ctx.agentBudget} USDC
Execute mandates from your wallet. Never touch the user's personal wallet without explicit approval.`;
}

function buildMandatesSection(
  mandates: Array<{ name: string; type: string; status: string }>
): string {
  if (mandates.length === 0) {
    return "";
  }

  const list = mandates
    .map((m) => `- ${m.name} (${m.type}, ${m.status})`)
    .join("\n");

  return `# Active Mandates

${list}`;
}

function buildOnboardingSection(): string {
  return `# First Meeting

This is a new user. You haven't met them before. Your first priority is to understand who they are so you can help them well.

Start with a warm greeting. Then learn these things through natural conversation — don't ask them all at once, weave them in:

1. Are they new to crypto or experienced? (gauge from how they respond)
2. What country are they in? (needed for on/off-ramp defaults)
3. What do they want to use exo for? (sending money? saving? trading? all of the above?)
4. Do they have any immediate needs? (help them do something right away to build trust)

Be casual, curious, helpful. Not a questionnaire. If they want to skip and just start using the wallet, that's fine — let them, and learn from their actions instead.`;
}

function buildTokenReferenceSection(): string {
  return `# Token Reference (Base chain, chain ID 8453)

| Token | Address |
|-------|---------|
| USDC | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| WETH | 0x4200000000000000000000000000000000000006 |
| DAI | 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb |
| USDbC | 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6Da |
| cbETH | 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22 |`;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const sections: string[] = [];

  sections.push(buildIdentitySection());

  if (ctx.profile) {
    const userSection = buildUserSection(ctx.profile);
    if (userSection) {
      sections.push(userSection);
    }
  }

  sections.push(buildTrustSection(ctx));
  sections.push(buildToolsSection());
  sections.push(buildBehaviorSection());

  const walletSection = buildAgentWalletSection(ctx);
  if (walletSection) {
    sections.push(walletSection);
  }

  if (ctx.activeMandates && ctx.activeMandates.length > 0) {
    const mandatesSection = buildMandatesSection(ctx.activeMandates);
    if (mandatesSection) {
      sections.push(mandatesSection);
    }
  }

  if (!ctx.profile?.onboardingComplete) {
    sections.push(buildOnboardingSection());
  }

  sections.push(buildTokenReferenceSection());

  return sections.join("\n\n");
}
