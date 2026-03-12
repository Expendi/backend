interface JsonViewerProps {
  data: unknown;
  label?: string;
}

export function JsonViewer({ data, label }: JsonViewerProps) {
  if (data === null || data === undefined) return null;

  return (
    <div className="result-area">
      {label && <div className="result-label">{label}</div>}
      <pre className="json-viewer">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
