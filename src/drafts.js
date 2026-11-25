import { INKS } from "./ink.js";

// A new PDF revision must never inherit stamps from its source revision.
const key = (doc) => `inkdesk-draft:${doc.id}:${doc.revision ?? 0}`;

export function readDraftState(doc, storage = localStorage) {
  return readStoredDraftState(doc, storage) ?? validateDraftState(doc, null);
}

export function readStoredDraftState(doc, storage = localStorage) {
  const raw = storage.getItem(key(doc));
  return raw ? validateDraftState(doc, JSON.parse(raw)) : null;
}

export function validateDraftState(doc, saved) {
  if (saved === null) return { marks: [], color: Object.values(INKS).includes(doc.inkColor) ? doc.inkColor : INKS.Blue };
  const marks = Array.isArray(saved) ? saved : saved?.marks;
  if (!Array.isArray(marks) || !marks.every((mark) =>
    mark && Number.isInteger(mark.id) && mark.id > 0 &&
    Number.isInteger(mark.page) && mark.page >= 1 && mark.page <= doc.pages &&
    [mark.x, mark.y, mark.w, mark.ratio].every(Number.isFinite) &&
    mark.x >= 0 && mark.x <= 1 && mark.y >= 0 && mark.y <= 1 &&
    mark.w > 0 && mark.w <= 1 && mark.ratio > 0 &&
    typeof mark.image === "string" && mark.image.startsWith("data:image/png;base64,")
  ) || new Set(marks.map((mark) => mark.id)).size !== marks.length) {
    throw new Error("Invalid signature draft");
  }
  const color = Array.isArray(saved) ? marks[0]?.color : saved.color;
  return { marks, color: Object.values(INKS).includes(color) ? color : INKS.Blue };
}

export function readDraft(doc, storage = localStorage) {
  return readDraftState(doc, storage).marks;
}

export function writeDraftState(doc, { marks, color }, storage = localStorage) {
  storage.setItem(key(doc), JSON.stringify({ version: 2, marks, color }));
}

// Retained for callers that only store marks.
export function writeDraft(doc, marks, storage = localStorage) {
  if (!marks.length) return clearDraft(doc, storage);
  writeDraftState(doc, { marks, color: marks[0]?.color || INKS.Blue }, storage);
}

export function clearDraft(doc, storage = localStorage) {
  storage.removeItem(key(doc));
}
