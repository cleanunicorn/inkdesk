import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import * as storage from "../src/db.js";

const doc = (id) => ({ id, name: id + ".pdf", file: new Blob(["pdf"]), pages: 1 });

test("a blocked database upgrade reports how to recover and can be retried", async () => {
  const previous = await new Promise((resolve) => {
    const request = indexedDB.open("inkdesk-workspace", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("documents", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
  });
  try {
    await assert.rejects(storage.getDocuments(), /close.*Inkdesk.*tabs/i);
  } finally {
    previous.close();
  }
  assert.deepEqual(await storage.getDocuments(), []);
});

test("claim freezes the latest guest documents and forwards stale writes", async () => {
  await storage.saveDocument(doc("before"));
  const racingWrite = storage.saveDocument(doc("during"));
  const claim = storage.claimGuestDocuments(null, "guest:new", "account:claim");
  await racingWrite;
  const snapshot = await claim;
  assert.deepEqual(snapshot.docs.map(({ id }) => id), ["before", "during"]);
  await storage.saveDocument(doc("after"), null);
  assert.deepEqual((await storage.getDocuments("guest:new")).map(({ id }) => id), ["after"]);
  assert.deepEqual(await storage.claimGuestDocuments(null, "guest:new", "account:claim"), snapshot);
});

test("the version 2 cache migrates into independently writable account records", async () => {
  const { IDBFactory, IDBObjectStore } = await import("fake-indexeddb");
  const existing = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  const put = IDBObjectStore.prototype.put;
  try {
    const pdf = { version: "pdf-1", value: { id: "old", file: "cGRm", revision: 2 } };
    const account = "account:legacy";
    const old = await new Promise((resolve) => {
      const request = indexedDB.open("inkdesk-workspace", 2);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("documents", { keyPath: "id" });
        request.result.createObjectStore("workspaces").put({
          revision: 7, base: { "document:old": pdf.version }, records: { "document:old": pdf },
        }, account);
      };
      request.onsuccess = () => resolve(request.result);
    });
    old.close();
    const upgraded = await import("../src/db.js?legacy-cache");
    assert.deepEqual((await upgraded.changeAccount(account, null)).records, { "document:old": pdf });
    assert.deepEqual((await upgraded.getAccountState(account)).documents, { "document:old": 2 });

    const writes = [];
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === "account-records") writes.push(args[1]);
      return put.apply(this, args);
    };
    const draft = { version: "draft-new", value: [{ id: 1 }] };
    await upgraded.changeAccount(account, [], () => ({ changes: { "draft:old:2": draft } }));
    assert.deepEqual(writes, [[account, "draft:old:2"]]);
    assert.deepEqual((await upgraded.changeAccount(account, null)).records, {
      "document:old": pdf,
      "draft:old:2": draft,
    });
  } finally {
    IDBObjectStore.prototype.put = put;
    globalThis.indexedDB = existing;
  }
});
