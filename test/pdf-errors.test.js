import test from "node:test";
import assert from "node:assert/strict";
import { pdfOpenErrorMessage } from "../src/pdf-errors.js";

test("a failed PDF module load tells the user to reload, not replace the PDF", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: https://example.test/assets/pdf.js",
    "Importing a module script failed.",
    "error loading dynamically imported module",
    'Setting up fake worker failed: "Failed to fetch dynamically imported module".',
  ]) {
    assert.equal(
      pdfOpenErrorMessage(new TypeError(message)),
      "The PDF tools could not load. Reload Inkdesk and try again.",
    );
  }
});

test("document and storage failures keep their specific guidance", () => {
  assert.match(pdfOpenErrorMessage({ name: "InvalidPDFException", message: "Invalid PDF structure." }), /valid, undamaged PDF/);
  assert.match(pdfOpenErrorMessage(new Error("encrypted PDF")), /password-protected/);
  assert.equal(pdfOpenErrorMessage({ name: "CertificationError", message: "No annotations allowed." }), "No annotations allowed.");
  assert.equal(pdfOpenErrorMessage(new Error("Choose a PDF file to continue.")), "Choose a PDF file to continue.");
  assert.match(pdfOpenErrorMessage({ name: "QuotaExceededError" }), /storage is full/);
});
