let connection;
function openDatabase() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("inkdesk-workspace", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("documents", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      connection = null;
      throw error;
    });
  }
  return connection;
}

async function transact(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("documents", mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error || new Error("Storage unavailable"));
    action(tx.objectStore("documents"), (value) => {
      result = value;
    });
  });
}

export function getDocuments() {
  return transact("readonly", (store, done) => {
    const request = store.getAll();
    request.onsuccess = () => done(request.result);
  });
}

export function saveDocument(doc) {
  return transact("readwrite", (store) => store.add(doc));
}

export function saveSignedDocument(base, signed) {
  return transact("readwrite", (store, done) => {
    const read = store.get(base.id);
    read.onsuccess = () => {
      const current = read.result;
      // Older records have no revision. Compare and write under one store lock.
      const conflict =
        current && (current.revision ?? 0) !== (base.revision ?? 0);
      const doc = {
        id: conflict ? crypto.randomUUID() : base.id,
        name: conflict
          ? base.name.replace(/(?:\.pdf)?$/i, " (separate copy).pdf")
          : base.name,
        file: base.file,
        pages: base.pages,
        revision: conflict ? 1 : (base.revision ?? 0) + 1,
        updated: Date.now(),
        signed,
      };
      if (conflict || !current) store.add(doc);
      else store.put(doc);
      done({ doc, concurrentCopy: conflict ? current : null });
    };
  });
}
