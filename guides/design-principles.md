# Exo Design Principles

_Inspired by the Family wallet — making complex things feel welcoming._

Exo is built on three foundational design principles: **Simplicity**, **Fluidity**, and **Delight**. Every screen, transition, and interaction should be evaluated against these three pillars.

---

## 1. Simplicity — Progressive Disclosure

> "Features at your fingertips, but everything else appears as it becomes most relevant."

### The Tray System

Instead of navigating to full new pages for every action, Exo uses **layered trays** — overlaying sheets that preserve the user's context while presenting focused content.

**Rules:**
- Each tray is dedicated to a **single action or piece of content**
- Subsequent trays vary in height to make progression unmistakable
- Trays overlay (not replace) existing content — the user never loses their place
- Theme adapts to context (darker trays in transaction flows)
- Dismissal is intuitive: swipe down, tap backdrop, or explicit close

**Where we apply this:**
- Transaction detail → bottom tray, not full page
- Approval prompts → tray layered over the action that triggered it
- Settings sub-sections → expandable trays, not separate routes
- Agent tool confirmations → inline tray within chat

### Information Architecture

- **Don't front-load complexity.** Show the essential action first; reveal details on demand.
- **Empty states are opportunities.** Guide users toward their first action with animated hints.
- **Each screen should have ONE primary action.** If there are two, you need two trays.

---

## 2. Fluidity — Seamless Transitions

> "Moving through water — you float rather than walk through it."

Every animation serves an **architectural purpose**: it tells the user where they came from, where they are, and where they're going.

### Core Techniques

#### Directional Navigation
Tab transitions move in the direction selected. Left tap → content slides from left. Right tap → content slides from right. **"We fly instead of teleport."**

```css
/* Tab content enters from the direction of the selected tab */
.tab-content-enter-left { transform: translateX(-20px); opacity: 0; }
.tab-content-enter-right { transform: translateX(20px); opacity: 0; }
```

#### Text Morphing
When a CTA changes meaning (e.g., "Continue" → "Confirm" → "Done"), the label should **morph** rather than swap. Leverage shared letters where possible. This heightens user awareness of significant state changes.

#### Component Persistence
If a component exists on both the current and next screen, **it should not disappear and reappear** — it should animate to its new position. Wallet cards, balance displays, and status badges should feel like they travel with the user.

#### Contextual Unfolding
Actions should unfold from the element that triggered them. A swap confirmation unfolds from the swap button. A transaction detail expands from its list item. This creates **spatial continuity**.

#### Post-Action Feedback
After a transaction confirms, don't just show a static success screen. Animate the result into its final resting place (e.g., the pending indicator moves into the activity tab).

### Implementation Rules

- **Quick feedback:** 0.2–0.35s for user-initiated interactions (button press, tab switch)
- **Ambient motion:** 1.4–4s for loading states and background effects
- **Easing:** `cubic-bezier(0.22, 1, 0.36, 1)` for snappy, `cubic-bezier(0.34, 1.56, 0.64, 1)` for springy
- **Never animate without purpose.** If removing the animation makes the interaction unclear, it belongs. If not, it's decoration.

---

## 3. Delight — Selective Emphasis

> "Mastering delight is mastering selective emphasis."

### The Delight-Impact Curve

Delight potential **increases as feature usage frequency decreases.**

| Frequency | Approach | Example |
|-----------|----------|---------|
| **Every session** | Efficiency, don't be overbearing | Balance display, tab switching |
| **Weekly** | Smooth and satisfying | Sending tokens, checking activity |
| **Monthly** | Memorable and rewarding | First swap, setting up goals |
| **Once** | Maximum celebration | Wallet creation, first deposit, backup complete |

### Delight Moments in Exo

1. **Transaction success:** Brief confetti burst + haptic feedback. Rewards completing a financial action.
2. **Balance changes:** Animated counter that counts up/down to new value. "+$50.00" indicator that floats and fades.
3. **Wallet backup complete:** Full-screen confetti. Security deserves celebration.
4. **First tool execution:** Subtle shimmer on the agent's response when a tool runs for the first time.
5. **Goal milestones:** Progress bar animation + celebration when reaching savings targets.
6. **Stealth mode:** Gentle shimmer signals "I'm still watching" while values are hidden.
7. **Empty state hints:** Animated arrows/indicators guiding users toward their first action.
8. **Pull to refresh:** Satisfying snap-back with brief skeleton shimmer.

### Equal Polish

> "Users notice when parts of an app are less polished, which detracts from the overall experience."

Every interaction is a potential delight moment. Infrequent features are opportunities, not afterthoughts. The trash action should feel as considered as the send action.

---

## Design Tokens (Quick Reference)

```css
/* Timing */
--transition-fast: 0.15s cubic-bezier(0.22, 1, 0.36, 1);
--transition: 0.3s cubic-bezier(0.22, 1, 0.36, 1);
--transition-slow: 0.5s cubic-bezier(0.22, 1, 0.36, 1);
--bounce: cubic-bezier(0.34, 1.56, 0.64, 1);

/* Motion */
--slide-distance: 20px;
--tray-enter: 0.35s cubic-bezier(0.22, 1, 0.36, 1);
--confetti-duration: 1.5s;
```

---

## Applying to the Exo Agent

The agent chat is Exo's primary interface. These principles apply directly:

### Simplicity in Chat
- Tool confirmations appear as **inline trays** — not separate modals
- Results are progressively disclosed: summary first, details on tap
- The agent never dumps raw data; it presents the essential answer with expandable context

### Fluidity in Chat
- Messages animate in with directional awareness (user from right, agent from left)
- Tool execution states transition smoothly (thinking → executing → complete)
- When a tool produces a result that affects the wallet, the balance display updates with animation

### Delight in Chat
- Successful transactions get the same confetti treatment in chat as in the traditional UI
- The thinking indicator feels alive (gentle floating motion, not just bouncing dots)
- First-time tool uses get a subtle highlight to build user confidence in the agent
