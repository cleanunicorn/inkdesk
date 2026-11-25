import test from "node:test";
import assert from "node:assert/strict";
import { createDocumentId } from "../src/document-id.js";

test("document IDs remain unique without the secure-context randomUUID API", (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else delete crypto.randomUUID;
  });
  const ids = Array.from({ length: 100 }, () => createDocumentId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});
