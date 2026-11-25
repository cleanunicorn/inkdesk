// A new signed PDF revision must never inherit stamps from its source revision.
const draftKey = (doc) => `inkdesk-draft:${doc.id}:${doc.revision ?? 0}`;

export function readDraft(doc, storage = localStorage) {
  const raw = storage.getItem(draftKey(doc));
  if (!raw) return [];
  return validateDraft(doc, JSON.parse(raw));
}

export function validateDraft(doc, marks) {
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
  return marks;
}

export function writeDraft(doc, marks, storage = localStorage) {
  if (!marks.length) return clearDraft(doc, storage);
  storage.setItem(draftKey(doc), JSON.stringify(marks));
}

export function clearDraft(doc, storage = localStorage) {
  storage.removeItem(draftKey(doc));
}
