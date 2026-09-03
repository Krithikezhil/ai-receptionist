import { cookies } from "next/headers";

export interface CurrentUser {
  id: string;
  email: string;
  createdAt: string;
}

export function getApiUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}

/**
 * Server-side auth check for protected pages. Forwards the incoming
 * request's cookies to the API's GET /auth/me and trusts only its answer —
 * the backend is the authority here, not the presence/absence of a cookie
 * on this side. See SECURITY.md "Backend security boundary".
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  const res = await fetch(`${getApiUrl()}/auth/me`, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = (await res.json()) as { user: CurrentUser };
  return data.user;
}
