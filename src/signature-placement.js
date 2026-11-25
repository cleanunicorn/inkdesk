import { crop, INKS, loadInk } from "./ink.js";
import { renderInk } from "./pen.js";
import { pickSample, signatureSamples, variation } from "./signature-samples.js";

export async function signaturePlacement(signature, previousSample = -1) {
  const samples = signatureSamples(signature);
  if (!samples.length) throw new Error("Create a signature first.");
  const sampleIndex = pickSample(samples.length, previousSample);
  const sample = samples[sampleIndex];
  const seed = Math.floor(Math.random() * 4294967296);
  const canvas = document.createElement("canvas");
  if (sample.strokes?.length) {
    renderInk(canvas, sample.strokes, INKS.Black, seed, { fit: true });
  } else {
    // Typed and legacy PNG signatures retain their shape with subtle slant and
    // proportion variation. Fit the transformed rectangle, including very wide
    // or tall samples for which a constant padding would not be enough.
    const img = await loadInk(sample.image), v = variation(seed);
    canvas.width = 2 * Math.ceil((Math.abs(v.stretch) * img.naturalWidth +
      Math.abs(v.slant) * img.naturalHeight) / 2) + 4;
    canvas.height = 2 * Math.ceil((Math.abs(v.tilt) * img.naturalWidth + img.naturalHeight) / 2) + 4;
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.transform(v.stretch, v.tilt, v.slant, 1, 0, 0);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  }
  // Store the actual chosen pixels, so reopening or exporting cannot reroll it.
  return { ...crop(canvas), sampleIndex, seed };
}
