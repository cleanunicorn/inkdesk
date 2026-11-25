import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Include lazy-loaded signing code and PDF resources, not user documents.
const files = (await readdir("dist", { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== "sw.js")
  .map((entry) => `${entry.parentPath}/${entry.name}`)
  .sort();
const hash = createHash("sha256");
for (const file of files) hash.update(file).update(await readFile(file));
const cache = `inkdesk-static-${hash.digest("hex").slice(0, 16)}`;
const urls = files.map((file) => "/" + file.replace(/^dist\//, ""));
await writeFile("dist/sw.js", `
const CACHE = ${JSON.stringify(cache)};
const ASSETS = ${JSON.stringify(urls)};
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});
// Wait for existing tabs to close before activating a new app version.
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith("inkdesk-static-") && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (event.request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(caches.open(CACHE).then(cache => cache.match("/index.html")));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(url.pathname)) || fetch(event.request)));
  }
});
`);
