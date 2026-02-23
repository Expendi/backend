import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import App from "./App";

const appId = import.meta.env.VITE_PRIVY_APP_ID;

if (!appId) {
  throw new Error("VITE_PRIVY_APP_ID is not set in .env");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PrivyProvider appId={appId}>
      <App />
    </PrivyProvider>
  </StrictMode>
);
