// Run with BetterWright against the Vite development server, with one disposable
// signature/text placement selected. Drag checks update that test draft, then
// reverse each drag to restore its geometry.
// betterwright run --session <session> test/browser/signature-regressions.js
await snapshot({ interactive: true });
const mark = page.locator(".mark.active");
if (await mark.count() !== 1) throw new Error("Select one signature or text placement in a test PDF first.");
const checks = [];
for (const width of [320, 390, 1280]) {
  await page.setViewportSize({ width, height: 900 });
  await mark.scrollIntoViewIfNeeded();
  checks.push(await mark.evaluate((node, viewport) => {
    const originalWidth = node.style.width;
    const sizes = [];
    try {
      for (const pixels of [12, 73, 160]) {
        node.style.width = `${pixels}px`;
        const box = node.getBoundingClientRect();
        for (const handle of node.querySelectorAll(".resize-handle")) {
          const corner = handle.dataset.corner;
          const x = corner.includes("w") ? box.left : box.right;
          const y = corner.includes("n") ? box.top : box.bottom;
          const target = document.elementFromPoint(x, y)?.closest(".resize-handle");
          if (target !== handle) throw new Error(`${viewport}px viewport, ${pixels}px mark: ${corner} hits ${target?.dataset.corner}`);
          const rect = handle.getBoundingClientRect();
          const marker = getComputedStyle(handle, "::after");
          const centerX = rect.left + parseFloat(marker.left) + parseFloat(marker.width) / 2;
          const centerY = rect.top + parseFloat(marker.top) + parseFloat(marker.height) / 2;
          if (Math.abs(centerX - x) > 0.1 || Math.abs(centerY - y) > 0.1) {
            throw new Error(`Visible marker moved away from ${corner}`);
          }
        }
        sizes.push({ width: box.width, height: box.height, corners: 4 });
      }
    } finally {
      node.style.width = originalWidth;
    }
    return { viewport, sizes };
  }, width));
}
// Exercise the actual pointer handlers on the short, real placement as well.
await page.setViewportSize({ width: 320, height: 900 });
await mark.scrollIntoViewIfNeeded();
const drags = [];
for (const corner of ["nw", "ne", "sw", "se"]) {
  const sx = corner.includes("w") ? -1 : 1, sy = corner.includes("n") ? -1 : 1;
  const before = await mark.boundingBox();
  const at = (box) => ({ x: box.x + (sx > 0 ? box.width : 0), y: box.y + (sy > 0 ? box.height : 0) });
  const anchor = (box) => ({ x: box.x + (sx < 0 ? box.width : 0), y: box.y + (sy < 0 ? box.height : 0) });
  let point = at(before);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + sx * 15, point.y + sy * 5, { steps: 5 });
  await page.mouse.up();
  const after = await mark.boundingBox();
  const originalAnchor = anchor(before), newAnchor = anchor(after);
  if (after.width <= before.width || Math.abs(originalAnchor.x - newAnchor.x) > 0.2 ||
      Math.abs(originalAnchor.y - newAnchor.y) > 0.2) throw new Error(`Wrong resize anchor for ${corner}`);
  point = at(after);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x - sx * 15, point.y - sy * 5, { steps: 5 });
  await page.mouse.up();
  const restored = await mark.boundingBox();
  if (["x", "y", "width", "height"].some((key) => Math.abs(restored[key] - before[key]) > 0.2)) {
    throw new Error(`Reverse drag did not restore ${corner}`);
  }
  drags.push(corner);
}
const edgeInk = await page.evaluate(async () => {
  const { renderInk } = await import("/src/pen.js");
  const fixtures = [
    [[100, 2], [500, 2], [900, 2]],
    [[100, 358], [500, 358], [900, 358]],
    [[2, 20], [2, 180], [2, 340]],
    [[998, 20], [998, 180], [998, 340]],
  ];
  return fixtures.map((positions, edge) => {
    const strokes = [positions.map(([x, y]) => ({ x, y, width: 4 }))];
    const reference = document.createElement("canvas");
    reference.width = 1100; reference.height = 460;
    reference.getContext("2d").translate(50, 50);
    renderInk(reference, strokes, "#242526", 1);
    const fitted = document.createElement("canvas");
    renderInk(fitted, strokes, "#242526", 1, { fit: true });
    const coverage = (canvas) => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let alpha = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 8) alpha += data[i];
      return alpha;
    };
    const expected = coverage(reference), actual = coverage(fitted);
    // Allow small canvas-readback/antialiasing differences, not missing strokes.
    if (Math.abs(actual - expected) / expected > 0.005) throw new Error(`Ink lost at edge ${edge}: ${actual}/${expected}`);
    return { edge, fitted: actual, reference: expected };
  });
});
return { cornerChecks: checks, drags, edgeInk };
