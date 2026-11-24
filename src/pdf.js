import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
export { signedPDF } from "./signing.js";
GlobalWorkerOptions.workerSrc = worker;
export async function openPDF(blob) {
  const data = await blob.arrayBuffer();
  const assets = new URL("pdf-assets/", document.baseURI).href;
  const task = getDocument({
    data,
    isEvalSupported: false,
    cMapUrl: assets + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: assets + "standard_fonts/",
    wasmUrl: assets + "wasm/",
    iccUrl: assets + "iccs/",
  });

  try {
    return await task.promise;
  } catch (error) {
    await task.destroy();
    throw error;
  }
}
export async function sampleFile() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.16, 0.14, 0.21),
    purple = rgb(0.43, 0.28, 0.72);
  const line = (text, y, size = 13, font = regular, color = ink) =>
    page.drawText(text, { x: 55, y, size, font, color });
  line("INKDESK", 760, 13, bold, purple);
  line("Sample agreement", 694, 32, bold);
  line("A practice document for your signature", 661, 15);
  page.drawLine({
    start: { x: 55, y: 631 },
    end: { x: 540, y: 631 },
    thickness: 1,
    color: rgb(0.85, 0.84, 0.88),
  });
  line("This sample gives you a place to try signing a PDF.", 585);
  line("Place your signature on the line below, then download a copy.", 560);
  line("Signed by", 386, 13, bold);
  page.drawLine({
    start: { x: 55, y: 295 },
    end: { x: 365, y: 295 },
    thickness: 1,
    color: ink,
  });
  line("Signature", 274, 11);
  return new File([await pdf.save()], "Sample agreement.pdf", {
    type: "application/pdf",
  });
}
