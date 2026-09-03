export interface ReceptionistConfiguration {
  id: string;
  organizationId: string;
  enabled: boolean;
  displayName: string;
  greeting: string;
  tone: string;
  instructions: string;
  fallbackMessage: string;
  afterHoursMessage: string;
  callTransferEnabled: boolean;
  callTransferPhone: string | null;
  language: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * No fields are required — every column has a deterministic DB-level
 * default except callTransferPhone (which has none, correctly nullable).
 * `create()` always passes `enabled: false` explicitly regardless of what's
 * given here — organization creation must never activate the receptionist.
 */
export interface NewReceptionistConfiguration {
  organizationId: string;
  displayName?: string;
  greeting?: string;
  tone?: string;
  instructions?: string;
  fallbackMessage?: string;
  afterHoursMessage?: string;
  callTransferPhone?: string | null;
  language?: string;
}

export interface ReceptionistConfigurationUpdate {
  enabled?: boolean | undefined;
  displayName?: string | undefined;
  greeting?: string | undefined;
  tone?: string | undefined;
  instructions?: string | undefined;
  fallbackMessage?: string | undefined;
  afterHoursMessage?: string | undefined;
  callTransferEnabled?: boolean | undefined;
  callTransferPhone?: string | null | undefined;
  language?: string | undefined;
}

export interface ReceptionistConfigRepository {
  findByOrganizationId(organizationId: string): Promise<ReceptionistConfiguration | undefined>;
  create(config: NewReceptionistConfiguration): Promise<ReceptionistConfiguration>;
  update(
    organizationId: string,
    changes: ReceptionistConfigurationUpdate,
  ): Promise<ReceptionistConfiguration | undefined>;
}
