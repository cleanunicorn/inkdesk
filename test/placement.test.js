import test from "node:test";
import assert from "node:assert/strict";
import { resizeMark, boundMark } from "../src/placement.js";
import { penWidth } from "../src/pen.js";
const mark = { x: 0.3, y: 0.3, w: 0.2, ratio: 2.5 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

for (const page of [{ width: 595, height: 842 }, { width: 842, height: 595 }]) {
  for (const corner of ["nw", "ne", "sw", "se"]) {
    test(`resize ${corner} on ${page.width}px page keeps its opposite corner and aspect ratio`, () => {
      const west = corner.includes("w"), north = corner.includes("n");
      const h = (m) => m.w * page.width / page.height / m.ratio;
      const resized = resizeMark(mark, corner, west ? -0.1 : 0.1, north ? -0.1 : 0.1, page);
      assert.ok(resized.w > mark.w);
      close(resized.x + (west ? resized.w : 0), mark.x + (west ? mark.w : 0));
      close(resized.y + (north ? h(resized) : 0), mark.y + (north ? h(mark) : 0));
      close(resized.ratio, mark.ratio);
      const largest = resizeMark(mark, corner, west ? -10 : 10, north ? -10 : 10, page);
      assert.ok(largest.x >= -1e-10 && largest.y >= -1e-10);
      assert.ok(largest.x + largest.w <= 1 + 1e-10 && largest.y + h(largest) <= 1 + 1e-10);
      const smallest = resizeMark(mark, corner, west ? 10 : -10, north ? 10 : -10, page);
      close(smallest.w, 0.03);
    });
  }
}
test("resizing responds to vertical motion and does not jump on pointer down", () => {
  const page = { width: 595, height: 842 };
  assert.deepEqual(resizeMark(mark, "se", 0, 0, page), mark);
  assert.ok(resizeMark(mark, "se", 0, 0.1, page).w > mark.w);
  const tall = boundMark({ ...mark, ratio: 0.1 }, 0.9, 0.9, 0.8, page);
  assert.ok(tall.y + tall.w * page.width / page.height / tall.ratio <= 1);
});
test("mouse speed and actual stylus pressure produce natural width variation", () => {
  const previous = { x: 0, y: 0, time: 0 };
  const slow = { x: 4, y: 0, time: 20, pointerType: "mouse", pressure: 0.5 };
  assert.ok(penWidth(slow, previous) > penWidth({ ...slow, x: 80 }, previous));
  assert.ok(penWidth({ ...slow, pointerType: "pen", pressure: 0.8 }, previous) >
    penWidth({ ...slow, pointerType: "pen", pressure: 0.1 }, previous));
  assert.ok(Number.isFinite(penWidth({ ...slow, time: 0 }, previous)));
});

test("resizing to the top page edge keeps coordinates valid for draft recovery", async () => {
  const { readDraftState, writeDraftState } = await import("../src/drafts.js");
  const page = { width: 595, height: 842 };
  const original = { id: 1, page: 1, x: 0.2, y: 0.005, w: 0.08,
    ratio: 0.48461538461538467, image: "data:image/png;base64,abc" };
  for (const corner of ["nw", "ne"]) {
    const resized = resizeMark(original, corner, corner === "nw" ? -100 : 100, -100, page);
    assert.ok(resized.y >= 0, `top edge must not be negative: ${resized.y}`);
    let raw;
    const storage = { setItem: (_, value) => { raw = value; }, getItem: () => raw };
    writeDraftState({ id: "edge", pages: 1 }, { marks: [resized], color: "#214b9b" }, storage);
    assert.deepEqual(readDraftState({ id: "edge", pages: 1 }, storage).marks, [resized]);
  }
});
