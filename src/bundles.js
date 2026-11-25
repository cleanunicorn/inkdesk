import { createDocumentId } from "./document-id.js";

// Validate each source independently so one bad file cannot hide other uploads.
export async function importDocuments(files, { openPDF, validate, save, onDocument }) {
  const selected = Array.from(files);
  const bundle = selected.length > 1
    ? { bundleId: createDocumentId(), bundleName: `${selected[0].name} bundle` }
    : {};
  const documents = [], errors = [];
  for (const [bundleOrder, file] of selected.entries()) {
    let pdf;
    try {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        throw new Error("Choose a PDF file to continue.");
      }
      pdf = await openPDF(file);
      await validate(file);
      const doc = {
        id: createDocumentId(), name: file.name, file, pages: pdf.numPages,
        updated: Date.now(), ...bundle, ...(bundle.bundleId ? { bundleOrder } : {}),
      };
      try { await save(doc); } catch { doc.temporary = true; }
      documents.push(doc);
      onDocument(doc);
    } catch (error) {
      errors.push({ name: file.name, error });
    } finally {
      try {
        await pdf?.loadingTask.destroy();
      } catch (error) {
        // Cleanup must not discard the batch result or skip later files.
        console.warn("PDF upload cleanup failed", error);
      }
    }
  }
  return { documents, errors };
}

export function documentGroups(documents) {
  const groups = new Map();
  for (const doc of documents) {
    const key = doc.bundleId || doc.id;
    if (!groups.has(key)) groups.set(key, { id: key, name: doc.bundleName, documents: [], updated: 0 });
    const group = groups.get(key);
    group.documents.push(doc);
    group.updated = Math.max(group.updated, doc.updated || 0);
  }
  for (const group of groups.values()) group.documents.sort((a, b) => (a.bundleOrder || 0) - (b.bundleOrder || 0));
  return [...groups.values()].sort((a, b) => b.updated - a.updated);
}
