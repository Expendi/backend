interface StatusTagProps {
  status: string;
}

export function StatusTag({ status }: StatusTagProps) {
  const cls = `tag-exo status-${status}`;
  return <span className={cls}>{status}</span>;
}
