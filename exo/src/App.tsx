import { usePrivy } from "@privy-io/react-auth";
import { QueryClientProvider } from "@tanstack/react-query";
import { GloveProvider } from "glove-react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { queryClient } from "./lib/query-client";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ApprovalProvider } from "./context/ApprovalContext";
import { DashboardProvider } from "./context/DashboardContext";
import { ChatActionsProvider } from "./context/ChatActionsContext";
import { PreferencesProvider } from "./context/PreferencesContext";
import { AppModeProvider } from "./context/AppModeContext";
import { AppShell } from "./components/AppShell";
import { Spinner } from "./components/Spinner";
import { ConfettiCanvas } from "./components/Confetti";
import { ToastProvider } from "./components/Toast";
import { gloveClient } from "./lib/glove-client";

import { OnboardingPage } from "./pages/OnboardingPage";
import { WalletHomePage } from "./pages/WalletHomePage";
import { AgentPage } from "./pages/AgentPage";
import { ActivityPage } from "./pages/ActivityPage";
import { ReceivePage } from "./pages/ReceivePage";
import { SettingsPage } from "./pages/SettingsPage";
import { BuyPage } from "./pages/BuyPage";
import { SwapPage } from "./pages/SwapPage";
import { EarnPage } from "./pages/EarnPage";
import { RecurringPaymentsPage } from "./pages/RecurringPaymentsPage";
import { GoalsPage } from "./pages/GoalsPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { TransferPage } from "./pages/TransferPage";
import { GroupsPage } from "./pages/GroupsPage";
import { SplitExpensesPage } from "./pages/SplitExpensesPage";
import { SwapAutomationsPage } from "./pages/SwapAutomationsPage";
import { SecurityPage } from "./pages/SecurityPage";
import { WalletsPage } from "./pages/WalletsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { AgentDashboardPage } from "./pages/AgentDashboardPage";

import "./styles/exo-tokens.css";
import "./styles/components.css";
import "./styles/layout.css";
import "./styles/pages.css";

function LoginScreen() {
  const { login, ready } = usePrivy();
  const { theme, toggleTheme } = useAuth();

  if (!ready) {
    return (
      <div className="login-screen">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <button
          className="theme-toggle-btn"
          onClick={toggleTheme}
          style={{ position: "absolute", top: 24, right: 24 }}
          title="Toggle theme"
        >
          {theme === "dark" ? "\u2600" : "\u263E"}
        </button>
        <h1>exo<span className="dot">.</span></h1>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 24 }}>
          Your AI-powered crypto wallet
        </p>
        <p>Send, receive, and manage your crypto with a simple conversation.</p>
        <button className="btn-exo btn-primary" onClick={login} style={{ fontSize: 15, padding: "14px 40px" }}>
          Get Started
        </button>
        <p style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginTop: 16, letterSpacing: 0.5 }}>
          Send, swap, and earn — all through conversation
        </p>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { authenticated, ready } = usePrivy();
  const { profile, loading } = useAuth();

  if (!ready || loading) {
    return (
      <div className="login-screen">
        <Spinner />
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen />;
  }

  if (!profile) {
    return <OnboardingPage />;
  }

  return (
    <ApprovalProvider>
      <PreferencesProvider>
        <DashboardProvider>
          <ChatActionsProvider>
            <AppModeProvider>
              <ToastProvider>
              <ConfettiCanvas />
              <Routes>
              <Route element={<AppShell />}>
                <Route index element={<WalletHomePage />} />
                <Route path="agent" element={<AgentPage />} />
                <Route path="agent/dashboard" element={<AgentDashboardPage />} />
                <Route path="activity" element={<ActivityPage />} />
                <Route path="receive" element={<ReceivePage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="buy" element={<BuyPage />} />
                <Route path="swap" element={<SwapPage />} />
                <Route path="earn" element={<EarnPage />} />
                <Route path="recurring" element={<RecurringPaymentsPage />} />
                <Route path="goals" element={<GoalsPage />} />
                <Route path="categories" element={<CategoriesPage />} />
                <Route path="transfer" element={<TransferPage />} />
                <Route path="groups" element={<GroupsPage />} />
                <Route path="split-expenses" element={<SplitExpensesPage />} />
                <Route path="swap-automations" element={<SwapAutomationsPage />} />
                <Route path="security" element={<SecurityPage />} />
                <Route path="wallets" element={<WalletsPage />} />
                <Route path="transactions" element={<TransactionsPage />} />
              </Route>
              </Routes>
              </ToastProvider>
            </AppModeProvider>
          </ChatActionsProvider>
        </DashboardProvider>
      </PreferencesProvider>
    </ApprovalProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <GloveProvider client={gloveClient}>
            <AuthenticatedApp />
          </GloveProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
