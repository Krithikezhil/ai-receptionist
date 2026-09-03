import request from "supertest";
import type { buildTestApp } from "./build-test-app.js";

export type TestAppContext = ReturnType<typeof buildTestApp>;

/** Registers a fresh user and returns a cookie-persisting agent + their user id. */
export async function registerAgent(ctx: TestAppContext, email: string) {
  const agent = request.agent(ctx.app);
  const res = await agent
    .post("/auth/register")
    .send({ email, password: "correct horse battery staple" });
  return { agent, userId: res.body.user.id as string };
}

export async function createOrg(agent: ReturnType<typeof request.agent>, name: string) {
  const res = await agent.post("/organizations").send({ name });
  return res.body as {
    organization: { id: string; name: string; slug: string };
    membership: { role: string; userId: string; organizationId: string };
    businessProfile: { id: string; organizationId: string; businessName: string };
    receptionistConfig: { id: string; organizationId: string; enabled: boolean };
  };
}
