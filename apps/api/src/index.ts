import { HEALTH_PATH, HEALTH_RESPONSE } from "@zk-wallet/contracts";
import { Hono } from "hono";

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

export const app = new Hono();

app.use("*", async (context, next) => {
  await next();

  for (const [name, value] of Object.entries(securityHeaders)) {
    context.res.headers.set(name, value);
  }
});

app.get(HEALTH_PATH, (context) => context.json(HEALTH_RESPONSE));

app.notFound((context) =>
  context.json(
    {
      error: {
        code: "not_found",
        message: "The requested resource does not exist.",
      },
    },
    404,
  ),
);

export default app;
