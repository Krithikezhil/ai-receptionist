import { redirect } from "next/navigation";
import { LogoutButton } from "../../components/logout-button";
import { KnowledgeManager } from "../../components/knowledge/knowledge-manager";
import { BusinessHoursForm } from "../../components/organizations/business-hours-form";
import { BusinessProfileForm } from "../../components/organizations/business-profile-form";
import { CreateOrganizationForm } from "../../components/organizations/create-organization-form";
import { ServicesManager } from "../../components/organizations/services-manager";
import { ReceptionistConfigForm } from "../../components/receptionist/receptionist-config-form";
import {
  getBusinessHours,
  getBusinessProfile,
  getReceptionistConfig,
  listKnowledge,
  listOrganizations,
  listServices,
} from "../../lib/organizations";
import { getCurrentUser } from "../../lib/session";

export default async function DashboardPage() {
  const user = await getCurrentUser();

  // The redirect here is a UX convenience, not the security boundary — the
  // API independently rejects unauthenticated requests to every protected
  // endpoint regardless of what this page does. See SECURITY.md.
  if (!user) {
    redirect("/login");
  }

  const organizations = await listOrganizations();

  if (organizations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-6 dark:bg-black">
        <div className="flex w-full max-w-sm flex-col items-start gap-2">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Welcome, {user.email}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            You don&apos;t belong to an organization yet.
          </p>
        </div>
        <CreateOrganizationForm />
        <LogoutButton />
      </div>
    );
  }

  // M3 does not build a multi-organization switcher UI — the backend fully
  // supports a user belonging to multiple organizations (see
  // ARCHITECTURE.md "Current organization"), but the dashboard shows the
  // first one. Every request below is still independently authorized
  // server-side regardless of this frontend simplification.
  const organization = organizations[0]!;

  const [businessProfile, businessHours, services, knowledge, receptionistConfig] =
    await Promise.all([
      getBusinessProfile(organization.id),
      getBusinessHours(organization.id),
      listServices(organization.id),
      listKnowledge(organization.id),
      getReceptionistConfig(organization.id),
    ]);

  return (
    <div className="flex flex-1 flex-col items-center gap-6 bg-zinc-50 px-6 py-10 dark:bg-black">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              {organization.name}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-500">Logged in as {user.email}</p>
          </div>
          <LogoutButton />
        </header>

        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          This is the M4 business knowledge / AI receptionist configuration foundation. Calling, AI
          conversations, leads, appointments, and billing are not implemented yet — see{" "}
          <code className="rounded bg-black/[.06] px-1.5 py-0.5 font-mono text-[0.9em] dark:bg-white/[.08]">
            TASKS.md
          </code>
          .
        </p>

        <BusinessProfileForm organizationId={organization.id} initialProfile={businessProfile} />
        <BusinessHoursForm organizationId={organization.id} initialHours={businessHours} />
        <ServicesManager organizationId={organization.id} initialServices={services} />
        <KnowledgeManager organizationId={organization.id} initialEntries={knowledge} />
        <ReceptionistConfigForm
          organizationId={organization.id}
          initialConfig={receptionistConfig}
        />
      </div>
    </div>
  );
}
