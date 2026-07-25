import { cp, mkdir, rm, writeFile } from "node:fs/promises";

await rm("dist", { force: true, recursive: true });
await mkdir("dist/client", { recursive: true });
await mkdir("dist/server", { recursive: true });
await cp("apps/web/dist", "dist/client", { recursive: true });

await writeFile(
  "dist/server/index.js",
  `const securityHeaders = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; object-src 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

export default {
  async fetch(request, env) {
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && request.method === "GET") {
      response = await env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    return new Response(response.body, { headers, status: response.status, statusText: response.statusText });
  }
};
`,
);
