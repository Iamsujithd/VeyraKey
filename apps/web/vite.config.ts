import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const securityHeaders = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'none'; object-src 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
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
    headers: securityHeaders,
  },
});
