import type {
  KnowledgeEntry,
  KnowledgeEntryUpdate,
  KnowledgeListFilter,
  KnowledgeRepository,
  NewKnowledgeEntry,
} from "../repositories/knowledge-types.js";

export interface KnowledgeService {
  listKnowledge(organizationId: string, filter?: KnowledgeListFilter): Promise<KnowledgeEntry[]>;
  createKnowledge(
    organizationId: string,
    input: Omit<NewKnowledgeEntry, "organizationId">,
  ): Promise<KnowledgeEntry>;
  /** undefined means "not found for this organization" — identical whether the id doesn't exist at all or belongs to a different organization. */
  updateKnowledge(
    organizationId: string,
    knowledgeId: string,
    changes: KnowledgeEntryUpdate,
  ): Promise<KnowledgeEntry | undefined>;
  deleteKnowledge(organizationId: string, knowledgeId: string): Promise<boolean>;
}

export function createKnowledgeService(repo: KnowledgeRepository): KnowledgeService {
  return {
    async listKnowledge(organizationId, filter) {
      return repo.listByOrganizationId(organizationId, filter);
    },

    async createKnowledge(organizationId, input) {
      return repo.create({ ...input, organizationId });
    },

    async updateKnowledge(organizationId, knowledgeId, changes) {
      return repo.update(knowledgeId, organizationId, changes);
    },

    async deleteKnowledge(organizationId, knowledgeId) {
      return repo.deleteByIdAndOrganizationId(knowledgeId, organizationId);
    },
  };
}
