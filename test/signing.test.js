import test from "node:test";
import assert from "node:assert/strict";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import {
  CertificationError,
  loadForSigning,
  signedPDF,
} from "../src/signing.js";

const name = PDFName.of;
const mark = {
  page: 1,
  x: 0.2,
  y: 0.2,
  w: 0.5,
  ratio: 1,
  image:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAAUSURBVAiZY2BgYPjPwMDAwMQABQAOFgECnMIVEAAAAABJRU5ErkJggg==",
};
const preview = {
  getPage: async () => ({
    getViewport: () => ({
      width: 200,
      height: 200,
      rotation: 0,
      convertToPdfPoint: (x, y) => [x, 200 - y],
    }),
  }),
};

async function documentWithField(permission) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([200, 200]);
  pdf.getForm().createTextField("Name").addToPage(page);
  if (permission !== undefined) {
    const certification = pdf.context.register(
      pdf.context.obj({
        Type: "Sig",
        Reference: [
          {
            TransformMethod: "DocMDP",
            TransformParams: permission === null ? {} : { P: permission },
          },
        ],
      }),
    );
    pdf.catalog.set(name("Perms"), pdf.context.obj({ DocMDP: certification }));
  }
  return new Blob([await pdf.save()]);
}

test("incremental exports retain previous revisions and put printable stamps after existing widgets", async () => {
  let source = await documentWithField(3);
  for (let count = 1; count <= 2; count++) {
    const result = await signedPDF(source, [mark], preview);
    assert.deepEqual(
      await result.slice(0, source.size).arrayBuffer(),
      await source.arrayBuffer(),
    );
    const reopened = await PDFDocument.load(await result.arrayBuffer());
    const annotations = reopened
      .getPage(0)
      .node.lookup(name("Annots"), PDFArray);
    assert.equal(annotations.size(), 1 + count);
    assert.equal(
      annotations.lookup(0, PDFDict).lookup(name("Subtype")),
      name("Widget"),
    );
    const stamp = annotations.lookup(count, PDFDict);
    assert.equal(stamp.lookup(name("Subtype")), name("Stamp"));
    assert.equal(stamp.lookup(name("F")).asNumber() & 4, 4);
    assert.ok(stamp.lookup(name("AP"), PDFDict).lookup(name("N")));
    assert.deepEqual(
      stamp
        .lookup(name("Rect"), PDFArray)
        .asArray()
        .map((n) => n.asNumber()),
      [40, 60, 140, 160],
    );
    source = result;
  }
});

test("both import and export honor certifications that prohibit annotations", async () => {
  for (const permission of [1, 2, null]) {
    const source = await documentWithField(permission);
    await assert.rejects(loadForSigning(source), CertificationError);
    await assert.rejects(
      signedPDF(source, [mark], preview),
      CertificationError,
    );
  }
});
