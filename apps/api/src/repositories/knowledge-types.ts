export type KnowledgeCategory = "faq" | "policy" | "service_info" | "custom";

export interface KnowledgeEntry {
  id: string;
  organizationId: string;
  title: string;
  content: string;
  category: KnowledgeCategory;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewKnowledgeEntry {
  organizationId: string;
  title: string;
  content: string;
  category?: KnowledgeCategory | undefined;
  active?: boolean | undefined;
}

export interface KnowledgeEntryUpdate {
  title?: string | undefined;
  content?: string | undefined;
  category?: KnowledgeCategory | undefined;
  active?: boolean | undefined;
}

export interface KnowledgeListFilter {
  category?: KnowledgeCategory | undefined;
  active?: boolean | undefined;
  /** Case-insensitive substring match against title + content. Not full-text search. */
  q?: string | undefined;
}

export interface KnowledgeRepository {
  listByOrganizationId(
    organizationId: string,
    filter?: KnowledgeListFilter,
  ): Promise<KnowledgeEntry[]>;
  /**
   * Scoped by (id, organizationId) in the same query — the mechanism that
   * makes cross-tenant access impossible by construction. Same pattern as
   * ServiceRepository. See SECURITY.md "Tenant isolation".
   */
  findByIdAndOrganizationId(
    id: string,
    organizationId: string,
  ): Promise<KnowledgeEntry | undefined>;
  create(entry: NewKnowledgeEntry): Promise<KnowledgeEntry>;
  update(
    id: string,
    organizationId: string,
    changes: KnowledgeEntryUpdate,
  ): Promise<KnowledgeEntry | undefined>;
  deleteByIdAndOrganizationId(id: string, organizationId: string): Promise<boolean>;
}
