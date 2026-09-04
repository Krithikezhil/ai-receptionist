/**
 * The per-organization secret that authorizes /internal/v1/*. See
 * src/auth/organization-service-token.ts for generation/hashing and
 * src/middleware/require-organization-service-token.ts for verification.
 */
export interface OrganizationServiceCredential {
  organizationId: string;
  tokenHash: string;
  createdAt: Date;
}

export interface NewOrganizationServiceCredential {
  organizationId: string;
  tokenHash: string;
}

export interface OrganizationServiceCredentialRepository {
  /** Called exactly once, inside the organization-creation transaction. */
  create(credential: NewOrganizationServiceCredential): Promise<OrganizationServiceCredential>;
  findByOrganizationId(organizationId: string): Promise<OrganizationServiceCredential | undefined>;
}
