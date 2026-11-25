import test from "node:test";
import assert from "node:assert/strict";
import { renderInk } from "../src/pen.js";

// Inspect the renderer's emitted circles, including its transform, rather than
// duplicating the bounds calculation. Every painted circle must fit the canvas.
function recordingCanvas() {
  const circles = [];
  let offset = [0, 0];
  const saved = [];
  const context = {
    clearRect() {}, beginPath() {}, fill() {},
    save() { saved.push([...offset]); },
    restore() { offset = saved.pop(); },
    translate(x, y) { offset[0] += x; offset[1] += y; },
    arc(x, y, radius) { circles.push({ x: x + offset[0], y: y + offset[1], radius }); },
  };
  return { width: 1000, height: 360, getContext: () => context, circles };
}

const edgeStrokes = {
  top: [[100, 2], [500, 2], [900, 2]],
  bottom: [[100, 358], [500, 358], [900, 358]],
  left: [[2, 20], [2, 180], [2, 340]],
  right: [[998, 20], [998, 180], [998, 340]],
  dot: [[0, 0]],
};
for (const [edge, positions] of Object.entries(edgeStrokes)) {
  test(`fitted pen variants preserve all ink at the ${edge} edge`, () => {
    const strokes = [positions.map(([x, y]) => ({ x, y, width: 4 }))];
    for (const seed of [1, 10, 777, 4294967295]) {
      const canvas = recordingCanvas();
      renderInk(canvas, strokes, "#242526", seed, { fit: true });
      assert.ok(canvas.circles.length);
      for (const { x, y, radius } of canvas.circles) {
        assert.ok(x - radius >= 0 && y - radius >= 0 &&
          x + radius <= canvas.width && y + radius <= canvas.height,
        `${edge}, seed ${seed}: ink outside ${canvas.width}x${canvas.height} at (${x}, ${y}), radius ${radius}`);
      }
    }
  });
}

test("live drawing keeps its fixed pad and fitted rendering restores the canvas transform", () => {
  const canvas = recordingCanvas();
  const strokes = [[{ x: 2, y: 2, width: 4 }]];
  renderInk(canvas, strokes, "#242526");
  assert.equal(canvas.width, 1000);
  assert.equal(canvas.height, 360);
  renderInk(canvas, strokes, "#242526", 1, { fit: true });
  canvas.circles.length = 0;
  renderInk(canvas, strokes, "#242526");
  assert.equal(canvas.circles[0].x, 2);
  assert.equal(canvas.circles[0].y, 2);
});
