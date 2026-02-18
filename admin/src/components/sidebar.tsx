"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Wallet,
  ArrowRightLeft,
  Clock,
  FileCode,
  Tag,
  UserCheck,
  LayoutDashboard,
  Repeat,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/wallets", label: "Wallets", icon: Wallet },
  { href: "/transactions", label: "Transactions", icon: ArrowRightLeft },
  { href: "/jobs", label: "Jobs", icon: Clock },
  { href: "/recurring-payments", label: "Recurring Payments", icon: Repeat },
  { href: "/contracts", label: "Contracts", icon: FileCode },
  { href: "/categories", label: "Categories", icon: Tag },
  { href: "/impersonate", label: "Impersonate", icon: UserCheck },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center border-b border-border px-6">
        <h1 className="text-lg font-semibold tracking-tight">Expendi Admin</h1>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-4">
        <p className="text-xs text-muted-foreground">Expendi v1.0.0</p>
      </div>
    </aside>
  );
}
