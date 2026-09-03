import { redirect } from "next/navigation";
import { LogoutButton } from "../../components/logout-button";
import { getCurrentUser } from "../../lib/session";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  // The redirect here is a UX convenience, not the security boundary — the
  // API independently rejects unauthenticated requests to every protected
  // endpoint regardless of what this page does. See SECURITY.md.
  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <div className="flex w-full max-w-lg flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Dashboard</h1>
        <p className="text-zinc-700 dark:text-zinc-300">
          Logged in as <span className="font-medium">{user.email}</span>.
        </p>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          This is an authenticated placeholder for M2. Calling, AI conversations, leads,
          appointments, and billing are not implemented yet — see{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            TASKS.md
          </code>{" "}
          for current scope.
        </p>
        <LogoutButton />
      </div>
    </div>
  );
}
