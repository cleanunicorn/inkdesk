export const INKS = { Black: "#242526", Blue: "#214b9b" };

export function crop(canvas) {
  const ctx = canvas.getContext("2d"), { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) {
      left = Math.min(x, left); right = Math.max(x, right);
      top = Math.min(y, top); bottom = Math.max(y, bottom);
    }
  }
  if (right < left) throw new Error("Add some writing first.");
  const out = document.createElement("canvas");
  out.width = right - left + 9;
  out.height = bottom - top + 9;
  out.getContext("2d").drawImage(canvas, left, top, right - left + 1,
    bottom - top + 1, 4, 4, right - left + 1, bottom - top + 1);
  return { image: out.toDataURL("image/png"), ratio: out.width / out.height };
}

export async function textInk(text, color, handwritten = true) {
  const font = handwritten ? "100px Allura" : '54px "DM Sans Variable"';
  await document.fonts.load(font);
  const canvas = document.createElement("canvas");
  let ctx = canvas.getContext("2d");
  ctx.font = font;
  const lines = text.trim().split("\n");
  const lineHeight = handwritten ? 120 : 80;
  canvas.width = Math.ceil(Math.max(...lines.map((line) => ctx.measureText(line).width))) + 120;
  canvas.height = lines.length * lineHeight + 100;
  ctx = canvas.getContext("2d");
  ctx.font = font;
  ctx.fillStyle = color;
  lines.forEach((line, i) => ctx.fillText(line, 60, 110 + i * lineHeight));
  return crop(canvas);
}

export function loadInk(image) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("This signature could not be loaded. Please draw it again."));
    img.src = image;
  });
}

// Preserve alpha and dimensions, so recoloring never changes placement geometry.
export async function recolorInk(image, color) {
  const img = await loadInk(image);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export async function colorDocument(marks, color) {
  const images = new Map();
  for (const mark of marks) {
    if (!images.has(mark.image)) images.set(mark.image, await recolorInk(mark.image, color));
  }
  return marks.map((mark) => ({ ...mark, image: images.get(mark.image), color }));
}
