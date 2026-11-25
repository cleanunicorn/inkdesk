import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import * as firstTab from "../src/db.js";
import * as secondTab from "../src/db.js?second-tab";

test("racing saves preserve both signed outputs without the secure-context randomUUID API", async (t) => {
  const original = {
    id: crypto.randomUUID(),
    name: "Consent.pdf",
    pages: 1,
    file: new Blob(["original"]),
  };
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else delete crypto.randomUUID;
  });
  await firstTab.saveDocument(original);
  const [a] = await firstTab.getDocuments();
  const [b] = await secondTab.getDocuments();
  const results = await Promise.all([
    firstTab.saveSignedDocument(a, new Blob(["signature A"])),
    secondTab.saveSignedDocument(b, new Blob(["signature B"])),
  ]);

  const copies = await firstTab.getDocuments();
  assert.equal(copies.length, 2);
  assert.equal(new Set(copies.map((doc) => doc.id)).size, 2);
  assert.deepEqual(
    (await Promise.all(copies.map((doc) => doc.signed.text()))).sort(),
    ["signature A", "signature B"],
  );
  const conflict = results.find((result) => result.concurrentCopy);
  assert.equal(conflict.concurrentCopy.id, original.id);
  assert.notEqual(conflict.doc.name, original.name);
  assert.equal(await conflict.doc.file.text(), "original");

  const edited = await secondTab.saveSignedDocument(
    conflict.doc,
    new Blob(["additional signature"]),
  );
  assert.equal(edited.concurrentCopy, null);
  assert.equal(edited.doc.id, conflict.doc.id);
  assert.equal(edited.doc.revision, 2);
  assert.equal((await firstTab.getDocuments()).length, 2);
});

test("an in-memory upload can enter the library after storage recovers", async () => {
  const local = {
    id: crypto.randomUUID(),
    name: "Other.pdf",
    pages: 1,
    file: new Blob(["original"]),
    temporary: true,
    inkColor: "#242526",
  };
  const { doc } = await firstTab.saveSignedDocument(
    local,
    new Blob(["signed"]),
  );
  assert.equal(doc.id, local.id);
  assert.equal(await doc.signed.text(), "signed");
  assert.equal(doc.temporary, undefined);
  assert.equal(doc.inkColor, "#242526");
});

test("bundle membership survives storage and signed revisions without merging files", async () => {
  const bundleId = crypto.randomUUID();
  const originals = [0, 1].map((bundleOrder) => ({
    id: crypto.randomUUID(), name: `part-${bundleOrder}.pdf`, pages: bundleOrder + 1,
    file: new Blob([`original ${bundleOrder}`]), bundleId, bundleName: "Agreement", bundleOrder,
  }));
  for (const doc of originals) await firstTab.saveDocument(doc);
  for (const doc of originals) await firstTab.saveSignedDocument(doc, new Blob([`signed ${doc.bundleOrder}`]));
  const stored = (await secondTab.getDocuments()).filter((doc) => doc.bundleId === bundleId)
    .sort((a, b) => a.bundleOrder - b.bundleOrder);
  assert.equal(stored.length, 2);
  assert.deepEqual(stored.map((doc) => doc.pages), [1, 2]);
  assert.deepEqual(await Promise.all(stored.map((doc) => doc.file.text())), ["original 0", "original 1"]);
  assert.deepEqual(await Promise.all(stored.map((doc) => doc.signed.text())), ["signed 0", "signed 1"]);
});
