const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function boundMark(mark, x, y, width, page) {
  const max = Math.min(0.9, 0.9 * mark.ratio * page.height / page.width);
  const w = clamp(width, Math.min(0.03, max), max);
  const h = w * page.width / page.height / mark.ratio;
  return { ...mark, w, x: clamp(x, 0, 1 - w), y: clamp(y, 0, 1 - h) };
}

// Keep the opposite corner anchored. Project pointer motion onto the aspect
// ratio's diagonal in page pixels, so either horizontal or vertical drags work.
export function resizeMark(mark, corner, dx, dy, page) {
  const west = corner.includes("w"), north = corner.includes("n");
  const sx = west ? -1 : 1, sy = north ? -1 : 1;
  const heightPerWidth = page.width / page.height / mark.ratio;
  const anchorX = mark.x + (west ? mark.w : 0);
  const anchorY = mark.y + (north ? mark.w * heightPerWidth : 0);
  const delta = (sx * dx + sy * dy * page.height / page.width / mark.ratio) /
    (1 + 1 / mark.ratio ** 2);
  const max = Math.min(
    0.9, 0.9 / heightPerWidth,
    west ? anchorX : 1 - anchorX,
    (north ? anchorY : 1 - anchorY) / heightPerWidth,
  );
  const w = clamp(mark.w + delta, Math.min(0.03, max), max);
  // Floating-point division/multiplication at a page edge can leave a tiny
  // negative coordinate, which would make the persisted draft fail validation.
  return { ...mark, w, x: clamp(west ? anchorX - w : anchorX, 0, 1 - w),
    y: clamp(north ? anchorY - w * heightPerWidth : anchorY, 0, 1 - w * heightPerWidth) };
}
