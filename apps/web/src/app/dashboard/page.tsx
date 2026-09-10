import { LogoutButton } from "../../components/logout-button";
import { LeadsTable } from "../../components/leads/leads-table";
import { AppointmentsTable } from "../../components/appointments/appointments-table";
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
  listServices,
} from "../../lib/organizations";
import { getDashboardContext } from "../../lib/dashboard-context";
import { listLeads } from "../../lib/leads";
import { listAppointments } from "../../lib/appointments";

export default async function DashboardPage() {
  const dashboardContext = await getDashboardContext();

  if (dashboardContext.status === "no-organization") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-6 dark:bg-black">
        <div className="flex w-full max-w-sm flex-col items-start gap-2">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Welcome, {dashboardContext.user.email}
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

  const { user, organization } = dashboardContext;

  const [businessProfile, businessHours, services, knowledge, receptionistConfig, leads, appointments] =
    await Promise.all([
      getBusinessProfile(organization.id),
      getBusinessHours(organization.id),
      listServices(organization.id),
      listKnowledge(organization.id),
      getReceptionistConfig(organization.id),
      listLeads(organization.id),
      listAppointments(organization.id),
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
          conversations, appointments, and billing are not implemented yet — see{" "}
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
        <LeadsTable
          organizationId={organization.id}
          initialLeads={leads}
        />
        <AppointmentsTable
          organizationId={organization.id}
          initialAppointments={appointments}
        />
      </div>
    </div>
  );
}
