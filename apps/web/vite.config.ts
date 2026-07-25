import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: https://www.googleapis.com https://graph.microsoft.com https://login.microsoftonline.com; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; object-src 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

const developmentSecurityHeaders = {
  ...securityHeaders,
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: https://www.googleapis.com https://graph.microsoft.com https://login.microsoftonline.com; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; object-src 'none'",
} as const;

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("libsodium")) return "crypto-runtime";
          if (id.includes("node_modules/react")) return "react-runtime";
          return undefined;
        },
      },
    },
    sourcemap: false,
  },
  plugins: [react()],
  preview: {
    headers: securityHeaders,
  },
  server: {
    headers: developmentSecurityHeaders,
    proxy: {
      "/__google_drive_api": {
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/__google_drive_api/u, ""),
        target: "https://www.googleapis.com",
      },
    },
  },
});
