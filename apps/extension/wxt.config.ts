import { defineConfig } from "wxt";
import { manifestForBrowser } from "./src/manifest";

export default defineConfig({
  manifest: ({ browser }) => manifestForBrowser(browser),
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
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
    },
  }),
});
