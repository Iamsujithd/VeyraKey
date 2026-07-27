import { defineConfig } from "wxt";
import { manifestForBrowser } from "./src/manifest";

export default defineConfig({
  manifest: ({ browser }) => manifestForBrowser(browser),
  modules: ["@wxt-dev/module-react"],
});
