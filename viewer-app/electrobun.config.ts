// viewer-app/electrobun.config.ts
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "sedno-viewer",
    identifier: "sh.sedno.viewer",
    version: "0.1.0",
  },
  build: {
    // bun.entrypoint defaults to "src/bun/index.ts" — left implicit, like the templates.
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
