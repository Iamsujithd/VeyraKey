import { HEALTH_PATH, HEALTH_RESPONSE } from "@zk-wallet/contracts";
import { describe, expect, it } from "vitest";
import { app } from "./index";

describe("control-plane API", () => {
  it("returns the versioned health contract with hardened headers", async () => {
    const response = await app.request(HEALTH_PATH);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(HEALTH_RESPONSE);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("does not expose an unversioned health route", async () => {
    expect((await app.request("/health")).status).toBe(404);
  });
});
