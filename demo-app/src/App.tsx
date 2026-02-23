import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

export default function App() {
  const { login, logout, authenticated, user, getAccessToken } = usePrivy();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!authenticated) {
      setToken(null);
      return;
    }
    getAccessToken().then(setToken);
  }, [authenticated, getAccessToken]);

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "80px auto", padding: "0 20px" }}>
      <h1>Expendi Auth Demo</h1>

      {!authenticated ? (
        <button onClick={login} style={btnStyle}>
          Login with Privy
        </button>
      ) : (
        <div>
          <p>
            <strong>Privy DID:</strong>{" "}
            <code style={codeStyle}>{user?.id}</code>
          </p>

          {token && (
            <div>
              <p><strong>Access Token:</strong></p>
              <pre style={{ ...codeStyle, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {token}
              </pre>
              <button onClick={() => copy(token)} style={btnStyle}>
                {copied ? "Copied!" : "Copy Token"}
              </button>
            </div>
          )}

          <div style={{ marginTop: 24 }}>
            <p><strong>Example curl:</strong></p>
            <pre style={{ ...codeStyle, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
{`curl http://localhost:3000/api/wallets \\
  -H "Authorization: Bearer ${token ?? "<token>"}"`}
            </pre>
          </div>

          <button onClick={logout} style={{ ...btnStyle, marginTop: 24, background: "#666" }}>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "10px 20px",
  fontSize: 16,
  border: "none",
  borderRadius: 6,
  background: "#111",
  color: "#fff",
  cursor: "pointer",
};

const codeStyle: React.CSSProperties = {
  background: "#f4f4f4",
  padding: "8px 12px",
  borderRadius: 4,
  fontSize: 14,
  display: "block",
};
