import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { createAccountsApi } from "./accounts.js";

const root = resolve("dist");
const database = process.env.INKDESK_DATABASE || "data/inkdesk.sqlite";
if (resolve(database).startsWith(root + sep)) {
  throw new Error("INKDESK_DATABASE must be outside the static build directory.");
}
const accounts = createAccountsApi({
  database,
  secureCookies: process.env.INKDESK_INSECURE_HTTP !== "1",
});
const types = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
  ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

const server = createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  accounts(req, res, async () => {
    try {
      if (!["GET", "HEAD"].includes(req.method)) {
        res.writeHead(405).end();
        return;
      }
      const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
      if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.setHeader("Content-Type", types[extname(file)] || "application/octet-stream");
      res.setHeader("Cache-Control", "no-cache");
      if (req.method === "HEAD") res.end();
      else {
        const stream = createReadStream(file);
        stream.on("error", () => res.destroy());
        res.on("close", () => stream.destroy());
        stream.pipe(res);
      }
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
});
const port = Number(process.env.PORT || 4173);
server.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log(`Inkdesk is listening on port ${port}`);
});
