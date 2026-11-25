import { resolve, sep } from "node:path";
import { defineConfig, normalizePath } from "vite";
import { createAccountsApi } from "./server/accounts.js";

const database = process.env.INKDESK_DATABASE || "data/inkdesk.sqlite";
const databaseFile = resolve(database);
const databaseFiles = new Set([resolve("data/inkdesk.sqlite"), databaseFile]);
const databasePatterns = [...databaseFiles].flatMap((file) => {
  const path = normalizePath(file).replace(/[?*\[\]{}()!+@]/g, "\\$&");
  return ["", "-wal", "-shm", "-journal"].map((suffix) => path + suffix);
});

function accounts(server) {
  server.middlewares.use(createAccountsApi({ database }));
}

export default defineConfig({
  plugins: [{
    name: "inkdesk-accounts",
    configResolved(config) {
      const staticDirs = [config.publicDir, resolve(config.root, config.build.outDir)];
      if (staticDirs.some((dir) => dir && databaseFile.startsWith(dir + sep))) {
        throw new Error("INKDESK_DATABASE must be outside Vite's public and build directories.");
      }
    },
    configureServer: accounts,
    configurePreviewServer: accounts,
  }],
  server: {
    host: "0.0.0.0",
    fs: {
      deny: [
        ".env", ".env.*", "*.{crt,pem}", "**/.git/**",
        ...databasePatterns,
      ],
    },
  },
  preview: {
    allowedHosts: ["cleanunicorn--4173.getbb.app"],
  },
});
