// Older saved signatures are single PNGs. Keep them usable as a first sample.
export function signatureSamples(signature) {
  return signature?.samples?.length ? signature.samples : signature?.image ? [signature] : [];
}

export function pickSample(count, previous = -1, random = Math.random()) {
  if (count <= 1) return 0;
  const hasPrevious = previous >= 0 && previous < count;
  const chosen = Math.min(count - (hasPrevious ? 2 : 1), Math.floor(random * (count - (hasPrevious ? 1 : 0))));
  return hasPrevious && chosen >= previous ? chosen + 1 : chosen;
}

export function variation(seed) {
  let value = seed >>> 0;
  const next = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
  return {
    phase: next() * Math.PI * 2,
    slant: (next() - 0.5) * 0.016,
    stretch: 1 + (next() - 0.5) * 0.018,
    weight: 0.94 + next() * 0.12,
    tilt: (next() - 0.5) * 0.012,
  };
}
