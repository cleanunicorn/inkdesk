import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { digitallySignPDF } from "../src/digital-signing.js";

let dir, certificate, source;
const password = "inkdesk-test-only";
const openssl = (args) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
before(async () => {
  dir = mkdtempSync(join(tmpdir(), "inkdesk-cert-test-"));
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "key.pem", "-out", "cert.pem",
    "-days", "2", "-subj", "/CN=Inkdesk Test Signer", "-addext", "keyUsage=digitalSignature"]);
  openssl(["pkcs12", "-export", "-inkey", "key.pem", "-in", "cert.pem", "-out", "identity.p12", "-passout", `pass:${password}`]);
  certificate = readFileSync(join(dir, "identity.p12"));
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  pdf.getForm().createTextField("Existing field").addToPage(page);
  source = await pdf.save();
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

function verifySignature(bytes, index = -1, tamper = false) {
  const raw = Buffer.from(bytes).toString("latin1");
  const matches = [...raw.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  const range = matches.at(index).slice(1).map(Number);
  assert.equal(range[0], 0);
  const signed = Buffer.concat([bytes.subarray(0, range[1]), bytes.subarray(range[2], range[2] + range[3])]);
  const cms = Buffer.from(raw.slice(range[1] + 1, range[2] - 1), "hex");
  if (tamper) signed[10] ^= 1;
  writeFileSync(join(dir, "signature.der"), cms);
  writeFileSync(join(dir, "content.bin"), signed);
  openssl(["cms", "-verify", "-binary", "-inform", "DER", "-in", "signature.der", "-content", "content.bin",
    "-noverify", "-out", "verified.bin"]);
  return range;
}

test("certificate signing covers the final PDF and independently verifies with OpenSSL", async () => {
  const signed = await digitallySignPDF(source, certificate, password);
  assert.deepEqual(signed.subarray(0, source.length), source);
  const range = verifySignature(signed);
  assert.equal(range[2] + range[3], signed.length);
  assert.throws(() => verifySignature(signed, -1, true), /CMS Verification failure/);
  const reopened = await PDFDocument.load(signed);
  assert.ok(reopened.getForm().getField("Existing field"));
  const fields = reopened.catalog.getOrCreateAcroForm().dict.lookup(PDFName.of("Fields"), PDFArray);
  assert.equal(fields.size(), 2);
  const signature = fields.lookup(1, PDFDict).lookup(PDFName.of("V"), PDFDict);
  assert.equal(signature.lookup(PDFName.of("SubFilter")), PDFName.of("adbe.pkcs7.detached"));
});

test("a second certificate signature preserves and verifies the first signed revision", async () => {
  const first = await digitallySignPDF(source, certificate, password);
  const second = await digitallySignPDF(first, certificate, password);
  assert.deepEqual(second.subarray(0, first.length), first);
  verifySignature(second, 0);
  verifySignature(second, 1);
});

test("wrong passwords, invalid bundles, expired certificates and certified PDFs fail closed", async () => {
  await assert.rejects(digitallySignPDF(source, certificate, "wrong"), /unlock/);
  await assert.rejects(digitallySignPDF(source, new Uint8Array([1, 2, 3]), password), /unlock/);
  await assert.rejects(digitallySignPDF(source, certificate, password, new Date("2100-01-01")), /expired/);
  const pdf = await PDFDocument.load(source);
  const ref = pdf.context.register(pdf.context.obj({ Type: "Sig", Reference: [{ TransformMethod: "DocMDP", TransformParams: { P: 3 } }] }));
  pdf.catalog.set(PDFName.of("Perms"), pdf.context.obj({ DocMDP: ref }));
  await assert.rejects(digitallySignPDF(await pdf.save(), certificate, password), /certified/);
});
