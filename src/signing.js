import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  drawObject,
} from "@cantoo/pdf-lib";

const key = PDFName.of;
export class CertificationError extends Error {
  constructor() {
    super(
      "This PDF’s certification does not permit signature stamps. Ask for a copy that allows annotations.",
    );
    this.name = "CertificationError";
  }
}

function checkPermissions(pdf) {
  const permissions = pdf.catalog.lookupMaybe(key("Perms"), PDFDict);
  const certification = permissions?.lookupMaybe(key("DocMDP"), PDFDict);
  // An approval signature can also impose document-level restrictions.
  const signatures = new Set();
  if (certification) signatures.add(certification);
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.has(key("ByteRange")) &&
      object.has(key("Reference"))
    ) {
      signatures.add(object);
    }
  }
  for (const signature of signatures) {
    const references = signature.lookupMaybe(key("Reference"), PDFArray);
    let found = false;
    for (const reference of references?.asArray() ?? []) {
      const transform = pdf.context.lookup(reference, PDFDict);
      if (transform.lookup(key("TransformMethod")) !== key("DocMDP")) continue;
      found = true;
      const params = transform.lookupMaybe(key("TransformParams"), PDFDict);
      if (params?.lookupMaybe(key("P"), PDFNumber)?.asNumber() !== 3) {
        throw new CertificationError();
      }
    }
    if (signature === certification && !found) throw new CertificationError();
  }
}

export async function loadForSigning(blob, incremental = false) {
  const pdf = await PDFDocument.load(await blob.arrayBuffer(), {
    updateMetadata: false,
    preserveXFA: true,
    forIncrementalUpdate: incremental,
  });
  checkPermissions(pdf);
  return pdf;
}

// The appearance occupies a unit square. The reader fits the rotated square
// to the annotation rectangle, which is expressed in unrotated PDF coordinates.
const matrices = {
  0: [1, 0, 0, 1, 0, 0],
  90: [0, 1, -1, 0, 1, 0],
  180: [-1, 0, 0, -1, 1, 1],
  270: [0, -1, 1, 0, 0, 1],
};

export async function signedPDF(blob, marks, preview) {
  const pdf = await loadForSigning(blob, true);
  const { context } = pdf;
  const images = new Map();
  for (const mark of marks) {
    if (!images.has(mark.image))
      images.set(mark.image, await pdf.embedPng(mark.image));
    const page = pdf.getPage(mark.page - 1);
    const viewport = (await preview.getPage(mark.page)).getViewport({
      scale: 1,
    });
    const left = mark.x * viewport.width;
    const top = mark.y * viewport.height;
    const width = mark.w * viewport.width;
    const [x1, y1] = viewport.convertToPdfPoint(left, top);
    const [x2, y2] = viewport.convertToPdfPoint(
      left + width,
      top + width / mark.ratio,
    );

    const appearance = context.formXObject([drawObject("Signature")], {
      BBox: [0, 0, 1, 1],
      Matrix: matrices[viewport.rotation],
      Resources: { XObject: { Signature: images.get(mark.image).ref } },
    });
    const stamp = context.register(
      context.obj({
        Type: "Annot",
        Subtype: "Stamp",
        P: page.ref,
        F: 4,
        Rect: [
          Math.min(x1, x2),
          Math.min(y1, y2),
          Math.max(x1, x2),
          Math.max(y1, y2),
        ],
        AP: { N: context.register(appearance) },
      }),
    );
    // Replace the page's array so a shared Annots array stays intact on other pages.
    const annotations = page.node.Annots()?.clone() ?? context.obj([]);
    annotations.push(stamp);
    page.node.set(key("Annots"), annotations);
  }
  return new Blob([await pdf.commit()], { type: "application/pdf" });
}
