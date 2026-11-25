import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import * as firstTab from "../src/db.js";
import * as secondTab from "../src/db.js?second-tab";

test("racing saves preserve both signed outputs for a pre-revision document", async () => {
  const original = {
    id: crypto.randomUUID(),
    name: "Consent.pdf",
    pages: 1,
    file: new Blob(["original"]),
  };
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
  };
  const { doc } = await firstTab.saveSignedDocument(
    local,
    new Blob(["signed"]),
  );
  assert.equal(doc.id, local.id);
  assert.equal(await doc.signed.text(), "signed");
  assert.equal(doc.temporary, undefined);
});
