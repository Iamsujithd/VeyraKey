import { describe, expect, it } from "vitest";
import { API_VERSION, HEALTH_PATH, HEALTH_RESPONSE } from "./index";

describe("health contract", () => {
  it("is stable, versioned, and content-free", () => {
    expect(API_VERSION).toBe("v1");
    expect(HEALTH_PATH).toBe("/v1/health");
    expect(HEALTH_RESPONSE).toEqual({
      apiVersion: "v1",
      service: "zk-wallet-api",
      status: "ok",
    });
  });
});
