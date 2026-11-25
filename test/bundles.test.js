import test from "node:test";
import assert from "node:assert/strict";
import { importDocuments, documentGroups } from "../src/bundles.js";
import { signedDocument } from "../src/db.js";

test("multi-upload keeps valid PDFs separate, ordered, and grouped across export", async () => {
  const files = [new File(["one"], "one.pdf"), new File(["bad"], "bad.pdf"), new File(["two"], "two.pdf")];
  const destroyed = [], saved = [];
  const { documents, errors } = await importDocuments(files, {
    openPDF: async (file) => ({ numPages: file.name === "one.pdf" ? 1 : 2, loadingTask: { destroy: () => destroyed.push(file.name) } }),
    validate: async (file) => { if (file.name === "bad.pdf") throw new Error("Invalid PDF"); },
    save: async (doc) => saved.push(doc), onDocument: () => {},
  });
  assert.equal(documents.length, 2);
  assert.equal(errors[0].name, "bad.pdf");
  assert.deepEqual(destroyed, files.map((file) => file.name));
  assert.equal(documents[0].bundleId, documents[1].bundleId);
  assert.notEqual(documents[0].id, documents[1].id);
  const outputs = documents.map((doc) => signedDocument(doc, doc, new Blob([`signed ${doc.name}`])).doc);
  assert.deepEqual(await Promise.all(outputs.map((doc) => doc.signed.text())), ["signed one.pdf", "signed two.pdf"]);
  assert.deepEqual(outputs.map((doc) => doc.pages), [1, 2]);
  assert.equal(documentGroups(outputs.reverse()).length, 1);
  assert.deepEqual(documentGroups(outputs)[0].documents.map((doc) => doc.name), ["one.pdf", "two.pdf"]);
  assert.equal(saved.length, 2);
});

test("failed storage retains all uploads as temporary bundle members", async () => {
  const { documents } = await importDocuments([new File([], "a.pdf"), new File([], "b.pdf")], {
    openPDF: async () => ({ numPages: 1, loadingTask: { destroy() {} } }),
    validate: async () => {}, save: async () => { throw new Error("quota"); }, onDocument: () => {},
  });
  assert.ok(documents.every((doc) => doc.temporary));
  const copy = signedDocument({ revision: 2 }, documents[0], new Blob(["signed"])).doc;
  assert.equal(copy.bundleId, documents[0].bundleId);
  assert.equal(documentGroups([copy, documents[1]]).length, 1);
});

test("a PDF cleanup failure does not skip the rest of the bundle", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const files = [new File([], "first.pdf"), new File([], "second.pdf")];
  const saved = [];
  const result = await importDocuments(files, {
    openPDF: async (file) => ({
      numPages: 1,
      loadingTask: { destroy: async () => {
        if (file.name === "first.pdf") throw new Error("Worker cleanup failed");
      } },
    }),
    validate: async () => {},
    save: async (doc) => saved.push(doc.name),
    onDocument: () => {},
  });
  assert.deepEqual(saved, ["first.pdf", "second.pdf"]);
  assert.equal(result.documents.length, 2);
  assert.equal(result.errors.length, 0);
  assert.equal(warning.mock.callCount(), 1);
});
