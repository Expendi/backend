import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusVariant =
  | "pending"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled"
  | "running"
  | "completed"
  | "active"
  | "paused"
  | "success";

const variantStyles: Record<StatusVariant, string> = {
  pending: "bg-yellow-500/15 text-yellow-500 border-yellow-500/20",
  submitted: "bg-blue-500/15 text-blue-500 border-blue-500/20",
  confirmed: "bg-green-500/15 text-green-500 border-green-500/20",
  completed: "bg-green-500/15 text-green-500 border-green-500/20",
  failed: "bg-red-500/15 text-red-500 border-red-500/20",
  cancelled: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  running: "bg-blue-500/15 text-blue-500 border-blue-500/20",
  active: "bg-green-500/15 text-green-500 border-green-500/20",
  paused: "bg-orange-500/15 text-orange-500 border-orange-500/20",
  success: "bg-green-500/15 text-green-500 border-green-500/20",
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const styles = variantStyles[status as StatusVariant] ?? variantStyles.pending;
  return (
    <Badge
      variant="outline"
      className={cn("text-xs font-medium capitalize", styles, className)}
    >
      {status}
    </Badge>
  );
}
