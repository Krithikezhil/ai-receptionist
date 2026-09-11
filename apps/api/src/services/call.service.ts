import type { Call, CallRepository, NewCall } from "../repositories/call-types.js";

export interface CallService {
  listCalls(organizationId: string): Promise<Call[]>;
  recordCall(
    organizationId: string,
    input: Omit<NewCall, "organizationId">,
  ): Promise<Call>;
}

export function createCallService(repo: CallRepository): CallService {
  return {
    async listCalls(organizationId) {
      return repo.listByOrganizationId(organizationId);
    },

    async recordCall(organizationId, input) {
      return repo.create({ ...input, organizationId });
    },
  };
}
