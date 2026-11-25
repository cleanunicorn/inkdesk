import { variation } from "./signature-samples.js";

// Coordinates and widths use the signature canvas's fixed 1000px space.
export function penWidth(point, previous) {
  if (point.pointerType === "pen" && point.pressure > 0) {
    return 1.6 + Math.sqrt(Math.min(1, point.pressure)) * 4.8;
  }
  if (!previous) return 3.2;
  const speed = Math.hypot(point.x - previous.x, point.y - previous.y) /
    Math.max(1, point.time - previous.time);
  return 2.1 + 3.8 / (1 + speed * 0.65);
}

// Resample by distance so smoothing does not depend on how often a device
// fires pointer events. Preserve endpoints and apply a short symmetric filter.
export function smoothStroke(points) {
  if (points.length < 3) return points.map((p) => ({ ...p }));
  const sampled = [{ ...points[0] }];
  let remaining = 3;
  for (let i = 1; i < points.length; i++) {
    let start = points[i - 1];
    const end = points[i];
    let distance = Math.hypot(end.x - start.x, end.y - start.y);
    while (distance >= remaining) {
      const t = remaining / distance;
      start = { x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        width: start.width + (end.width - start.width) * t };
      sampled.push(start);
      distance -= remaining;
      remaining = 3;
    }
    remaining -= distance;
  }
  sampled.push({ ...points.at(-1) });
  return sampled.map((point, i) => {
    if (i === 0 || i === sampled.length - 1) return point;
    let x = 0, y = 0, width = 0, total = 0;
    for (let j = -2; j <= 2; j++) {
      const neighbor = sampled[Math.max(0, Math.min(sampled.length - 1, i + j))];
      const weight = 3 - Math.abs(j);
      x += neighbor.x * weight; y += neighbor.y * weight;
      width += neighbor.width * weight; total += weight;
    }
    return { x: x / total, y: y / total, width: width / total };
  });
}

export function naturalStroke(points, seed, strokeIndex = 0) {
  const smooth = smoothStroke(points);
  if (seed === undefined) return smooth;
  const v = variation(seed + strokeIndex * 977);
  let distance = 0;
  return smooth.map((point, i) => {
    if (i) distance += Math.hypot(point.x - smooth[i - 1].x, point.y - smooth[i - 1].y);
    // Gentle, coherent changes along a stroke, not independent pixel jitter.
    const wave = Math.sin(distance / 80 + v.phase);
    return { x: 500 + (point.x - 500) * v.stretch + (point.y - 180) * v.slant,
      y: point.y + wave * 0.9 + (point.x - 500) * v.tilt,
      width: point.width * v.weight * (1 + 0.07 * wave) };
  });
}

export function renderInk(canvas, strokes, color, seed, { fit = false } = {}) {
  const paths = strokes.map((stroke, index) => naturalStroke(stroke, seed, index));
  let left = 0, top = 0;
  if (fit) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, radius = 0;
    for (const points of paths) for (const point of points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
      radius = Math.max(radius, point.width / 2);
    }
    if (Number.isFinite(minX)) {
      // The quadratic paths stay inside the control points' convex hull, and
      // interpolated/tapered widths cannot exceed this maximum pen radius.
      // Integer offsets preserve raster alignment; two extra pixels cover AA.
      left = Math.floor(minX - radius) - 2;
      top = Math.floor(minY - radius) - 2;
      canvas.width = Math.ceil(maxX + radius) + 2 - left;
      canvas.height = Math.ceil(maxY + radius) + 2 - top;
    } else {
      canvas.width = canvas.height = 1;
    }
  }
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(-left, -top);
  try {
    paintInk(ctx, paths, color);
  } finally {
    ctx.restore();
  }
}

function paintInk(ctx, paths, color) {
  ctx.fillStyle = color;
  for (const points of paths) {
    if (!points.length) continue;
    const dot = (x, y, radius) => {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    };
    if (points.length === 1) {
      dot(points[0].x, points[0].y, points[0].width / 2);
      continue;
    }
    // Midpoint quadratics smooth joins without changing the user's handwriting.
    let start = points[0];
    for (let i = 0; i < points.length; i++) {
      const control = points[i], next = points[i + 1];
      const end = next ? { x: (control.x + next.x) / 2,
        y: (control.y + next.y) / 2, width: (control.width + next.width) / 2 } : control;
      const steps = Math.max(1, Math.ceil((Math.hypot(control.x - start.x, control.y - start.y) +
        Math.hypot(end.x - control.x, end.y - control.y)) * 2));
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, u = 1 - t;
        const width = start.width * u + end.width * t;
        // A gentle entry and exit resemble lifting a pen off the paper.
        const taper = Math.min(1, 0.55 + (i + t) * 0.3,
          0.55 + (points.length - i - t) * 0.3);
        dot(u * u * start.x + 2 * u * t * control.x + t * t * end.x,
          u * u * start.y + 2 * u * t * control.y + t * t * end.y, width * taper / 2);
      }
      start = end;
    }
  }
}
