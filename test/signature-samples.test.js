import test from "node:test";
import assert from "node:assert/strict";
import { signatureSamples, pickSample } from "../src/signature-samples.js";
import { smoothStroke, naturalStroke } from "../src/pen.js";

const path = Array.from({ length: 41 }, (_, i) => ({ x: 100 + i * 3, y: 100 + (i % 2 ? 2 : -2), width: 4 }));

test("smoothing reduces small pointer jitter without moving endpoints or mutating samples", () => {
  const original = structuredClone(path);
  const smoothed = smoothStroke(path);
  assert.deepEqual(smoothed[0], path[0]);
  assert.deepEqual(smoothed.at(-1), path.at(-1));
  const deviation = smoothed.slice(2, -2).reduce((sum, p) => sum + Math.abs(p.y - 100), 0) / (smoothed.length - 4);
  assert.ok(deviation < 1);
  assert.deepEqual(path, original);
  assert.deepEqual(smoothStroke([path[0]]), [path[0]]);
});

test("natural variations are repeatable for a seed, distinct across seeds, and stay subtle", () => {
  const a = naturalStroke(path, 10);
  assert.deepEqual(a, naturalStroke(path, 10));
  assert.notDeepEqual(a, naturalStroke(path, 100));
  const smooth = smoothStroke(path);
  a.forEach((point, i) => {
    assert.ok(Math.abs(point.x - smooth[i].x) < 6);
    assert.ok(Math.abs(point.y - smooth[i].y) < 5);
    assert.ok(point.width > 3.4 && point.width < 4.6);
  });
});

test("sample selection covers the collection while avoiding immediate repeats", () => {
  assert.equal(pickSample(1, 0), 0);
  for (let previous = 0; previous < 5; previous++) {
    const seen = new Set(Array.from({ length: 100 }, (_, i) => pickSample(5, previous, i / 100)));
    assert.equal(seen.has(previous), false);
    assert.equal(seen.size, 4);
  }
  const legacy = { image: "legacy.png", ratio: 3 };
  assert.deepEqual(signatureSamples(legacy), [legacy]);
  assert.deepEqual(signatureSamples({ ...legacy, samples: [legacy, legacy] }), [legacy, legacy]);
});
