import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("GET /health", () => {
  it("returns ok status with service metadata", async () => {
    const app = createApp();

    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ok", service: "api" });
    expect(typeof response.body.timestamp).toBe("string");
    expect(typeof response.body.uptimeSeconds).toBe("number");
  });
});
