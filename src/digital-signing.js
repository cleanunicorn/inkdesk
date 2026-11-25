import forge from "node-forge";
import {
  PDFArray, PDFDict, PDFHexString, PDFInvalidObject, PDFName, PDFNumber, PDFString,
} from "@cantoo/pdf-lib";
import { loadForSigning } from "./signing.js";

const name = PDFName.of;
const reserveBytes = 32768;
function binary(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return result;
}

function readIdentity(bytes, password, now) {
  if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) {
    throw new Error("Choose a .p12 or .pfx certificate smaller than 2 MB.");
  }
  let bundle;
  try {
    bundle = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(binary(bytes)), false, password);
  } catch {
    throw new Error("Could not unlock the certificate. Check the file and password. An RSA .p12 or .pfx certificate is required.");
  }
  const bags = (type) => bundle.getBags({ bagType: type })[type] || [];
  const keys = [...bags(forge.pki.oids.pkcs8ShroudedKeyBag), ...bags(forge.pki.oids.keyBag)];
  if (keys.length !== 1 || !keys[0].key?.n) {
    throw new Error("Use a certificate bundle containing exactly one RSA private key.");
  }
  const key = keys[0].key;
  const certificates = bags(forge.pki.oids.certBag).map((bag) => bag.cert).filter(Boolean);
  const matches = certificates.filter((cert) => cert.publicKey.n?.compareTo(key.n) === 0 &&
    cert.publicKey.e?.compareTo(key.e) === 0);
  if (matches.length !== 1) throw new Error("The bundle must contain one certificate matching its private key.");
  const certificate = matches[0];
  if (now < certificate.validity.notBefore || now > certificate.validity.notAfter) {
    throw new Error("This certificate is expired or not yet valid. Choose a currently valid certificate.");
  }
  if (key.n.bitLength() < 2048) throw new Error("Use an RSA certificate with a key of at least 2048 bits.");
  const usage = certificate.getExtension("keyUsage");
  if (usage && !usage.digitalSignature && !usage.nonRepudiation) {
    throw new Error("This certificate does not permit digital signing.");
  }
  return { key, certificate, certificates };
}

function checkDigitalPermissions(pdf) {
  if (pdf.catalog.lookupMaybe(name("Perms"), PDFDict)?.has(name("DocMDP"))) {
    throw new Error("This PDF is certified. Sign its permitted signature field using a PDF reader; Inkdesk cannot add a certificate field to a certified PDF.");
  }
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFDict) || !object.has(name("ByteRange"))) continue;
    const refs = object.lookupMaybe(name("Reference"), PDFArray);
    if (refs?.asArray().some((ref) => {
      const method = pdf.context.lookup(ref, PDFDict).get(name("TransformMethod"));
      return method === name("DocMDP") || method === name("FieldMDP");
    })) throw new Error("This PDF has signing restrictions. Use a PDF reader to sign an existing permitted field.");
  }
}

// Detached CMS over the complete final PDF, excluding only /Contents. Append an
// incremental revision so prior signatures and original document bytes survive.
export async function digitallySignPDF(pdfBytes, certificateBytes, password, now = new Date()) {
  const identity = readIdentity(new Uint8Array(certificateBytes), password, now);
  const source = new Blob([pdfBytes], { type: "application/pdf" });
  const pdf = await loadForSigning(source, true);
  checkDigitalPermissions(pdf);
  const { context } = pdf;
  const page = pdf.getPage(0);
  const ranges = context.obj([0, name("InkdeskByteRange000000"), name("InkdeskByteRange000000"), name("InkdeskByteRange000000")]);
  const dictionary = context.obj({
    Type: "Sig", Filter: "Adobe.PPKLite", SubFilter: "adbe.pkcs7.detached",
    ByteRange: ranges, Contents: PDFHexString.of("0".repeat(reserveBytes * 2)),
    M: PDFString.fromDate(now),
    Name: PDFHexString.fromText(identity.certificate.subject.getField("CN")?.value || "Certificate signer"),
  });
  const rawBytes = new Uint8Array(dictionary.sizeInBytes());
  dictionary.copyBytesInto(rawBytes, 0);
  const raw = binary(rawBytes);
  const signatureRef = context.register(PDFInvalidObject.of(rawBytes));
  const appearance = context.register(context.formXObject([], { BBox: [0, 0, 0, 0], Resources: {} }));
  const widget = context.obj({
    Type: "Annot", Subtype: "Widget", FT: "Sig", Rect: [0, 0, 0, 0],
    V: signatureRef, T: PDFString.of(`InkdeskSignature${signatureRef.objectNumber}`),
    F: 132, P: page.ref, AP: { N: appearance },
  });
  const widgetRef = context.register(widget);
  const annotations = page.node.Annots()?.clone() || context.obj([]);
  annotations.push(widgetRef);
  page.node.set(name("Annots"), annotations);
  const form = pdf.catalog.getOrCreateAcroForm();
  const fields = form.dict.lookupMaybe(name("Fields"), PDFArray)?.clone() || context.obj([]);
  fields.push(widgetRef);
  form.dict.set(name("Fields"), fields);
  const flags = form.dict.lookupMaybe(name("SigFlags"), PDFNumber)?.asNumber() || 0;
  form.dict.set(name("SigFlags"), PDFNumber.of(flags | 3));

  const output = await pdf.commit();
  const serialized = binary(output);
  const objectStart = serialized.lastIndexOf(raw);
  if (objectStart < source.size) throw new Error("Could not reserve a safe signature field in this PDF.");
  const contentsStart = objectStart + raw.indexOf("/Contents <") + "/Contents ".length;
  const contentsEnd = contentsStart + reserveBytes * 2 + 2;
  const rangeText = `[0 ${contentsStart} ${contentsEnd} ${output.length - contentsEnd}]`;
  const rangePlaceholder = ranges.toString();
  if (rangeText.length > rangePlaceholder.length) throw new Error("This PDF is too large to sign.");
  const rangeOffset = objectStart + raw.indexOf(rangePlaceholder);
  output.set(new TextEncoder().encode(rangeText.padEnd(rangePlaceholder.length, " ")), rangeOffset);

  const cms = forge.pkcs7.createSignedData();
  cms.content = forge.util.createBuffer(binary(output.subarray(0, contentsStart)) + binary(output.subarray(contentsEnd)));
  identity.certificates.forEach((certificate) => cms.addCertificate(certificate));
  cms.addSigner({
    key: identity.key, certificate: identity.certificate, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.signingTime, value: now },
      { type: forge.pki.oids.messageDigest },
    ],
  });
  cms.sign({ detached: true });
  const hex = forge.util.bytesToHex(forge.asn1.toDer(cms.toAsn1()).getBytes());
  if (hex.length > reserveBytes * 2) throw new Error("The certificate chain is too large for this signature field.");
  output.set(new TextEncoder().encode(hex.padEnd(reserveBytes * 2, "0")), contentsStart + 1);
  return output;
}
