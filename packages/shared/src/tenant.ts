/**
 * Branded type for organization (tenant) identifiers.
 *
 * This exists so tenant IDs can't be accidentally passed where a plain
 * string was expected (or vice versa) once real organization-scoped models
 * are introduced in M3. See ARCHITECTURE.md "Multi-Tenancy" for the
 * enforcement strategy this type is part of.
 */
export type TenantId = string & { readonly __brand: "TenantId" };

export function toTenantId(value: string): TenantId {
  return value as TenantId;
}

/**
 * Marker interface for records that belong to a single organization.
 * Not used by real data models yet (none exist in M1) — it documents the
 * shape every future org-scoped table/entity is expected to follow.
 */
export interface TenantScoped {
  readonly tenantId: TenantId;
}
