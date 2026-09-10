import { redirect } from "next/navigation";
import { listOrganizations, type Organization } from "./organizations";
import { getCurrentUser, type CurrentUser } from "./session";

/**
 * M12 Step 2: composes the existing, unmodified getCurrentUser()/
 * listOrganizations() into one reusable server-side helper for dashboard
 * pages -- frontend UX/navigation convenience only, not a new
 * authorization mechanism. The backend independently re-authorizes every
 * API request regardless of what this helper returns; see SECURITY.md and
 * ARCHITECTURE.md "Backend security boundary" / "Current organization."
 */
export type DashboardContext =
  | { status: "no-organization"; user: CurrentUser }
  | { status: "ok"; user: CurrentUser; organization: Organization };

export async function getDashboardContext(): Promise<DashboardContext> {
  const user = await getCurrentUser();

  // UX convenience only, not the security boundary --
  // rejects unauthenticated requests to every protected endpoint regardless
  // of what this helper does. See SECURITY.md.
  if (!user) {
    redirect("/login");
  }

  const organizations = await listOrganizations();

  if (organizations.length === 0) {
    return { status: "no-organization", user };
  }

  // M3 does not build a multi-organization switcher UI -- the backend fully
  // supports a user belonging to multiple organizations, but the dashboard
  // shows the first one. Every request below is still independently
  // authorized server-side regardless of this frontend simplification.
  const organization = organizations[0]!;

  return { status: "ok", user, organization };
}
