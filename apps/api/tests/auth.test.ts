import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/build-test-app.js";

function getSetCookieHeader(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  expect(raw, "expected a Set-Cookie header").toBeTruthy();
  return raw![0]!;
}

describe("POST /auth/register", () => {
  let ctx: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    ctx = buildTestApp();
  });

  it("registers a new user, returns no password hash, and starts a session", async () => {
    const res = await request(ctx.app)
      .post("/auth/register")
      .send({ email: "new.user@example.com", password: "correct horse battery staple" });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "new.user@example.com" });
    expect(res.body.user.id).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/i);

    const cookie = getSetCookieHeader(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it("rejects invalid registration input", async () => {
    const badEmail = await request(ctx.app)
      .post("/auth/register")
      .send({ email: "not-an-email", password: "correct horse battery staple" });
    expect(badEmail.status).toBe(400);

    const shortPassword = await request(ctx.app)
      .post("/auth/register")
      .send({ email: "shortpw@example.com", password: "short" });
    expect(shortPassword.status).toBe(400);
  });

  it("rejects a duplicate email with 409 and does not create a second account", async () => {
    const email = "duplicate@example.com";
    const first = await request(ctx.app)
      .post("/auth/register")
      .send({ email, password: "correct horse battery staple" });
    expect(first.status).toBe(201);

    const second = await request(ctx.app)
      .post("/auth/register")
      .send({ email, password: "a totally different password" });
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).not.toMatch(/passwordHash|password_hash/i);

    const stored = await ctx.users.findByEmail(email);
    expect(stored?.createdAt).toEqual(expect.any(Date));
  });

  it("never stores the password in plaintext", async () => {
    const password = "correct horse battery staple";
    await request(ctx.app)
      .post("/auth/register")
      .send({ email: "hashcheck@example.com", password });

    const stored = await ctx.users.findByEmail("hashcheck@example.com");
    expect(stored).toBeDefined();
    expect(stored!.passwordHash).not.toBe(password);
    expect(stored!.passwordHash).not.toContain(password);
    expect(stored!.passwordHash.startsWith("$argon2id$")).toBe(true);
  });
});

describe("POST /auth/login", () => {
  let ctx: ReturnType<typeof buildTestApp>;
  const email = "login.user@example.com";
  const password = "correct horse battery staple";

  beforeEach(async () => {
    ctx = buildTestApp();
    await request(ctx.app).post("/auth/register").send({ email, password });
  });

  it("logs in with valid credentials and returns no password hash", async () => {
    const res = await request(ctx.app).post("/auth/login").send({ email, password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash/i);
    expect(getSetCookieHeader(res)).toMatch(/HttpOnly/i);
  });

  it("rejects an incorrect password with a generic error", async () => {
    const res = await request(ctx.app).post("/auth/login").send({ email, password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid email or password.");
  });

  it("rejects a nonexistent email with the identical generic error (no enumeration)", async () => {
    const wrongPassword = await request(ctx.app)
      .post("/auth/login")
      .send({ email, password: "definitely wrong" });
    const unknownEmail = await request(ctx.app)
      .post("/auth/login")
      .send({ email: "nobody@example.com", password: "whatever12345" });

    expect(unknownEmail.status).toBe(wrongPassword.status);
    expect(unknownEmail.body.error).toBe(wrongPassword.body.error);
  });
});

describe("session lifecycle", () => {
  let ctx: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    ctx = buildTestApp();
  });

  it("allows an authenticated session to access GET /auth/me", async () => {
    const agent = request.agent(ctx.app);
    await agent
      .post("/auth/register")
      .send({ email: "session.user@example.com", password: "correct horse battery staple" });

    const res = await agent.get("/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: "session.user@example.com" });
  });

  it("rejects an unauthenticated request to GET /auth/me", async () => {
    const res = await request(ctx.app).get("/auth/me");
    expect(res.status).toBe(401);
  });

  it("rejects GET /auth/me with a forged/garbage session cookie — the backend does not trust cookie presence alone", async () => {
    const res = await request(ctx.app)
      .get("/auth/me")
      .set("Cookie", "ai_receptionist_session=not-a-real-session-token");
    expect(res.status).toBe(401);
  });

  it("invalidates the session on logout", async () => {
    const agent = request.agent(ctx.app);
    await agent
      .post("/auth/register")
      .send({ email: "logout.user@example.com", password: "correct horse battery staple" });

    const beforeLogout = await agent.get("/auth/me");
    expect(beforeLogout.status).toBe(200);

    const logoutRes = await agent.post("/auth/logout");
    expect(logoutRes.status).toBe(204);

    const afterLogout = await agent.get("/auth/me");
    expect(afterLogout.status).toBe(401);
  });

  it("logout is idempotent when there is no active session", async () => {
    const res = await request(ctx.app).post("/auth/logout");
    expect(res.status).toBe(204);
  });
});
