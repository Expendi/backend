import { useState, type ReactNode, type FormEvent } from "react";
import { Spinner } from "./Spinner";
import { JsonViewer } from "./JsonViewer";

interface ApiFormProps {
  children: ReactNode;
  onSubmit: () => Promise<unknown>;
  submitLabel?: string;
  submitVariant?: "primary" | "danger" | "secondary";
  extraButtons?: ReactNode;
}

export function ApiForm({ children, onSubmit, submitLabel = "Submit", submitVariant = "primary", extraButtons }: ApiFormProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await onSubmit();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {children}
      <div className="form-actions">
        <button type="submit" className={`btn-exo btn-${submitVariant}`} disabled={loading}>
          {loading ? <Spinner /> : submitLabel}
        </button>
        {extraButtons}
      </div>
      {error && <div className="msg-error">{error}</div>}
      <JsonViewer data={result} label="Response" />
    </form>
  );
}
