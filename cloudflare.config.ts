// PillPal: assets-only Worker serving public/ (dir set in wrangler.config.ts).
// Deploy with `npx cf deploy`.
import { defineConfig } from "cf/config";

export default defineConfig({
  worker: {
    name: "pillpal",
    compatibilityDate: "2026-10-01",
    domains: ["pillpal.jettstauver.com"],
    workersDev: false,
    previewUrls: false,
  },
});
