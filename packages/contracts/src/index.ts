export const API_VERSION = "v1" as const;
export const HEALTH_PATH = `/${API_VERSION}/health` as const;

export const HEALTH_RESPONSE = Object.freeze({
  apiVersion: API_VERSION,
  service: "veyrakey-api",
  status: "ok",
} as const);

export type HealthResponse = typeof HEALTH_RESPONSE;
