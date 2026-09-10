import Link from "next/link";
import { LogoutButton } from "../logout-button";

/**
 * M12 Step 1: structural nav shell only. Deliberately has no organization/
 * user identity display and no links to not-yet-built sections -- both
 * would either require this component to fetch its own copy of
 * dashboard/page.tsx's existing getCurrentUser()/listOrganizations() data
 * (a duplication left for M12 Step 2's shared context helper) or point to
 * routes that don't exist yet. Only /dashboard exists today.
 */
export function DashboardNav() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[.08] bg-white px-6 py-4 dark:border-white/[.145] dark:bg-zinc-950">
      <Link href="/dashboard" className="text-sm font-semibold text-black dark:text-zinc-50">
        AI Receptionist
      </Link>
      <LogoutButton />
    </header>
  );
}
