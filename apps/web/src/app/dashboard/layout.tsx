import React, { type ReactNode } from "react";
import { DashboardNav } from "../../components/dashboard/dashboard-nav";

/**
 * M12 Step 1: structural dashboard shell only -- persistent nav and a main
 * content wrapper around every /dashboard/* page. Deliberately does NOT
 * fetch the current user or organization itself. Extracting a shared,
 * layout-and-page-reusable auth/organization-context helper is M12 Step
 * 2s job.
 */
export default function DashboardLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return React.createElement(
    "div",
    { className: "flex min-h-0 flex-1 flex-col" },
    React.createElement(DashboardNav),
    React.createElement(
      "main",
      { className: "flex flex-1 flex-col" },
      children,
    ),
  );
}
