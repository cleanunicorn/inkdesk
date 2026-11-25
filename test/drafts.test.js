import test from "node:test";
import assert from "node:assert/strict";
import { readDraft, writeDraft, clearDraft } from "../src/drafts.js";

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}
const doc = { id: "document-a", pages: 2 };
const marks = [{ id: 4, page: 2, x: 0.2, y: 0.3, w: 0.25, ratio: 2, image: "data:image/png;base64,abc" }];

test("drafts survive reopening and are isolated by document and PDF revision", () => {
  const store = storage();
  writeDraft(doc, marks, store);
  assert.deepEqual(readDraft({ ...doc }, store), marks);
  assert.deepEqual(readDraft({ ...doc, id: "other" }, store), []);
  assert.deepEqual(readDraft({ ...doc, revision: 1 }, store), []);
  const edited = [{ ...marks[0], x: 0.5, w: 0.3 }];
  writeDraft(doc, edited, store);
  assert.deepEqual(readDraft(doc, store), edited);
});

test("discard and removing the last placement clear the persisted draft", () => {
  const store = storage();
  writeDraft(doc, marks, store);
  clearDraft(doc, store);
  assert.deepEqual(readDraft(doc, store), []);
  writeDraft(doc, marks, store);
  writeDraft(doc, [], store);
  assert.deepEqual(readDraft(doc, store), []);
});

test("storage failures and malformed drafts are reported instead of silently erased", () => {
  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("denied"); } };
  assert.throws(() => readDraft(doc, denied), /denied/);
  assert.throws(() => writeDraft(doc, marks, denied), /full/);
  assert.throws(() => clearDraft(doc, denied), /denied/);
  assert.throws(() => readDraft(doc, { getItem: () => JSON.stringify([{ ...marks[0], page: 3 }]) }), /invalid/i);
});
