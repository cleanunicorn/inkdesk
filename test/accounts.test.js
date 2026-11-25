import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createAccountsApi } from "../server/accounts.js";
import "fake-indexeddb/auto";
import { AccountWorkspace, mergeRecords } from "../src/account.js";

const signature = { version: "signature-1", value: { image: "data:image/png;base64,c2ln", ratio: 2 } };
const document = {
  version: "document-1",
  value: { id: "test-pdf", name: "Test.pdf", pages: 1, revision: 1, file: "cGRm", signed: "c2lnbmVk" },
};
const draft = { version: "draft-1", value: [{ id: 1, page: 1 }] };
const blackInk = "#242526";

async function listen(t, database, maxRecordBytes) {
  const handler = createAccountsApi({ database, secureCookies: true, maxRecordBytes });
  const server = createServer((req, res) => handler(req, res, () => res.writeHead(404).end()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}/api`;
  const transport = fetch;
  return (path, { method = "GET", body, cookie, account, etag, site } = {}) => {
    const headers = {};
    if (body) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (account) headers["x-inkdesk-account"] = account;
    if (etag) headers["if-none-match"] = etag;
    if (site) headers["sec-fetch-site"] = site;
    return transport(`${root}/${path}`, { method, headers, body: JSON.stringify(body) });
  };
}

test("a claimed workspace persists across server instances and sessions", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "inkdesk-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const database = join(dir, "accounts.sqlite");
  const original = await listen(t, database);
  const credentials = { username: "sample-user", password: "test-password-only" };
  const records = { signature, "document:test-pdf": document, "draft:test-pdf:1": draft };
  const claim = await original("claim", { method: "POST", body: { ...credentials, records } });
  assert.equal(claim.status, 200);
  const { account } = await claim.json();
  const claimCookie = claim.headers.get("set-cookie");
  assert.match(claimCookie, /HttpOnly; SameSite=Strict; Max-Age=\d+; Secure/);
  const firstCookie = claimCookie.split(";")[0];

  // Verify an account saved by the previous snapshot schema upgrades in place.
  const legacy = new DatabaseSync(database);
  legacy.prepare("UPDATE accounts SET workspace = ? WHERE id = ?").run(JSON.stringify(records), account.id);
  legacy.prepare("DELETE FROM workspace_records WHERE account_id = ?").run(account.id);
  legacy.close();

  const second = await listen(t, database);
  assert.equal((await second("workspace", { account: account.id })).status, 401);
  assert.equal((await second("sign-in", {
    method: "POST", body: { ...credentials, password: "wrong-password" },
  })).status, 401);

  const login = await second("sign-in", { method: "POST", body: credentials });
  assert.equal(login.status, 200);
  assert.deepEqual((await login.json()).account, account);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  assert.notEqual(cookie, firstCookie);
  const auth = { cookie, account: account.id };

  const pulled = await second("workspace", auth);
  assert.deepEqual(await pulled.json(), { revision: 1, records });
  assert.equal((await second("workspace", { ...auth, account: "another-account" })).status, 401);
  assert.equal((await second("workspace", { ...auth, site: "cross-site" })).status, 403);
  assert.equal((await second("workspace", { ...auth, etag: pulled.headers.get("etag") })).status, 304);

  const next = { ...records, signature: { ...signature, version: "signature-2" } };
  const save = { ...auth, method: "PUT", body: { revision: 1, records: next } };
  assert.equal((await second("workspace", save)).status, 200);
  assert.equal((await original("workspace", save)).status, 409);
  const synced = await original("workspace", { cookie: firstCookie, account: account.id });
  assert.deepEqual(await synced.json(), { revision: 2, records: next });

  assert.equal((await second("sign-out", { ...auth, method: "POST", body: {} })).status, 200);
  assert.equal((await second("workspace", auth)).status, 401);
  assert.equal((await original("workspace", { cookie: firstCookie, account: account.id })).status, 200);
});

test("simultaneous exports keep both documents and their respective drafts", () => {
  const local = { ...document, version: "local", value: { ...document.value, signed: "bG9jYWw=" } };
  const remote = { ...document, version: "remote", value: { ...document.value, signed: "cmVtb3Rl" } };
  const remoteDraft = { ...draft, version: "remote-draft" };
  const merged = mergeRecords(
    { "document:test-pdf": "previous" },
    { "document:test-pdf": local, "draft:test-pdf:1": draft, signature },
    { "document:test-pdf": remote, "draft:test-pdf:1": remoteDraft },
  );
  const copy = Object.values(merged).find(({ value }) => value.signed === local.value.signed).value;
  assert.equal(copy.name, "Test (separate copy).pdf");
  assert.equal(merged[`draft:${copy.id}:1`], draft);
  assert.equal(merged["document:test-pdf"], remote);
  assert.equal(merged["draft:test-pdf:1"], remoteDraft);
  assert.equal(merged.signature, signature);
});

test("a pending draft moves to a copy when the remote PDF advances", () => {
  const key = "document:test-pdf";
  const draftKey = "draft:test-pdf:1";
  const advanced = { version: "document-2", value: { ...document.value, revision: 2, signed: "bmV3" } };
  const merged = mergeRecords(
    { [key]: document.version },
    { [key]: document, [draftKey]: draft },
    { [key]: advanced },
  );
  const copy = Object.entries(merged).find(([id]) => id.startsWith("document:") && id !== key)[1];
  assert.equal(merged[key], advanced);
  assert.equal(copy.value.revision, 1);
  assert.equal(copy.value.signed, document.value.signed);
  assert.equal(merged[`draft:${copy.value.id}:1`], draft);
  assert.equal(merged[draftKey], undefined);
});

test("record sync enforces a per-item limit and keeps independent records writable", async (t) => {
  const request = await listen(t, ":memory:", 512);
  const created = await request("claim", {
    method: "POST", body: { username: "record-test", password: "test-password-only", records: {} },
  });
  assert.equal(created.status, 200);
  const { account } = await created.json();
  const auth = { cookie: created.headers.get("set-cookie").split(";")[0], account: account.id };
  const write = (key, revision, record) =>
    request(`record?key=${encodeURIComponent(key)}`, { ...auth, method: "PUT", body: { revision, record } });
  const record = (version) => ({ ...document, version, value: { ...document.value, file: "A".repeat(350) } });
  assert.equal((await write("document:one", 1, record("one"))).status, 200);
  assert.equal((await write("document:two", 2, record("two"))).status, 200);
  assert.equal((await write("document:large", 3, {
    ...document, value: { ...document.value, file: "A".repeat(600) },
  })).status, 413);
  assert.equal((await write("signature", 3, signature)).status, 200);
  assert.equal((await write("signature", 3, signature)).status, 409);
  assert.deepEqual(await (await request("records", auth)).json(), {
    revision: 4, versions: { "document:one": "one", "document:two": "two", signature: signature.version },
  });
  assert.deepEqual(await (await request("record?key=document%3Atwo", auth)).json(), { record: record("two") });
  assert.equal((await write("document:two", 4, null)).status, 200);
  assert.equal((await request("record?key=document%3Atwo", auth)).status, 404);
});

test("the client syncs around a rejected PDF and can remove that PDF", async (t) => {
  const request = await listen(t, ":memory:", 512);
  const created = await request("claim", {
    method: "POST", body: { username: "client-test", password: "test-password-only" },
  });
  const { account } = await created.json();
  const cookie = created.headers.get("set-cookie").split(";")[0];
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (path, init) => {
    calls.push([init.method, path]);
    return request(path.slice("/api/".length), {
      cookie,
      account: init.headers["X-Inkdesk-Account"],
      method: init.method,
      etag: init.headers["If-None-Match"],
      body: init.body ? JSON.parse(init.body) : undefined,
    });
  };

  const first = new AccountWorkspace(account);
  const other = new AccountWorkspace(account);
  other.key += ":fresh-browser";
  await first.seed({
    "document:test-pdf": document,
    "document:large": {
      ...document, version: "large-version",
      value: { ...document.value, id: "large", file: "A".repeat(600) },
    },
    signature,
  });
  const [pdf] = first.getDocuments().filter(({ id }) => id === "test-pdf");
  await first.writeDraftState(pdf, { marks: [], color: blackInk });
  await assert.rejects(first.sync(), { status: 413 });
  await other.sync();
  assert.deepEqual(other.getDocuments().map(({ id }) => id), ["test-pdf"]);
  assert.deepEqual(other.getSignature(), signature.value);
  assert.deepEqual(other.readDraftState(other.getDocuments()[0]), { marks: [], color: blackInk });
  await first.removeDocument({ id: "large" });
  await first.sync();
  const before = calls.length;
  await first.sync();
  assert.deepEqual(calls.slice(before), [["GET", "/api/records"]]);
  await first.removeDocument({ id: "test-pdf" });
  await first.sync();
  await other.sync();
  assert.deepEqual(other.getDocuments(), []);
});

test("stale editor writes recover the original revision without replacing the newer PDF", async () => {
  const workspace = new AccountWorkspace({ id: "stale-editor" });
  await workspace.seed({ "document:test-pdf": document });
  const [original] = workspace.getDocuments();
  const peer = new AccountWorkspace({ id: "stale-editor" });
  const advanced = { ...document, version: "advanced", value: { ...document.value, revision: 2 } };
  await peer.update([], () => ({ changes: { "document:test-pdf": advanced } }));
  const previousReader = globalThis.FileReader;
  globalThis.FileReader = class {
    async readAsDataURL(blob) {
      this.result = "data:application/pdf;base64," + Buffer.from(await blob.arrayBuffer()).toString("base64");
      this.onload();
    }
  };
  try {
    const handle = {};
    const marks = [{ id: 1, page: 1, x: 0.4, y: 0.5, w: 0.2, ratio: 2, image: signature.value.image }];
    await workspace.writeDraftState(original, { marks, color: blackInk }, handle);
    await workspace.writeDraftState(original, { marks: [{ ...marks[0], x: 0.6 }], color: blackInk }, handle);
    await workspace.load();
    const docs = workspace.getDocuments();
    assert.equal(docs.length, 2);
    const copy = docs.find(({ id }) => id === handle.copyId);
    assert.equal(copy.revision, 1);
    assert.equal(await copy.signed.text(), await original.signed.text());
    assert.equal(workspace.readDraftState(copy).marks[0].x, 0.6);
    assert.equal(workspace.readDraftState(copy).color, blackInk);
    assert.equal(docs.find(({ id }) => id === original.id).revision, 2);
  } finally {
    globalThis.FileReader = previousReader;
  }
});
