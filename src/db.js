import { createDocumentId } from "./document-id.js";

let connection;
function openDatabase() {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open("inkdesk-workspace", 3);
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        reject(Object.assign(new Error("Close other Inkdesk tabs or app windows, then reload to update browser storage."), {
          code: "storage-blocked",
        }));
      };
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion < 1) db.createObjectStore("documents", { keyPath: "id" });
        const workspaces = event.oldVersion < 2
          ? db.createObjectStore("workspaces")
          : request.transaction.objectStore("workspaces");
        const records = db.createObjectStore("account-records");
        if (event.oldVersion === 2) {
          const read = workspaces.openCursor(IDBKeyRange.bound("account:", "account;"));
          read.onsuccess = () => {
            const cursor = read.result;
            if (!cursor) return;
            const { records: legacy, ...state } = cursor.value;
            if (legacy) {
              const versions = {};
              const documents = {};
              for (const [key, record] of Object.entries(legacy)) {
                records.put(record, [cursor.key, key]);
                versions[key] = record.version;
                if (key.startsWith("document:")) documents[key] = record.value.revision ?? 0;
              }
              cursor.update({ ...state, versions, documents });
            }
            cursor.continue();
          };
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) {
          db.close();
          return;
        }
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch((error) => {
      connection = null;
      throw error;
    });
  }
  return connection;
}

async function transact(mode, names, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let result;
    let failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure || tx.error || new Error("Storage unavailable"));
    const done = (value) => { result = value; };
    const fail = (error) => {
      failure = error;
      tx.abort();
    };
    try {
      action(tx, done, fail);
    } catch (error) {
      fail(error);
    }
  });
}

const guestTarget = (guest) => `guest-target:${guest ?? ""}`;
const stores = ["documents", "workspaces"];

function readGuestDocuments(tx, guest, done) {
  const request = guest
    ? tx.objectStore("workspaces").get(guest)
    : tx.objectStore("documents").getAll();
  request.onsuccess = () => done(guest ? Object.values(request.result ?? {}) : request.result);
}

export function getDocuments(guest) {
  return transact("readonly", stores, (tx, done) => readGuestDocuments(tx, guest, done));
}

export function claimGuestDocuments(guest, nextGuest, account, snapshot = () => ({})) {
  return transact("readwrite", stores, (tx, done, fail) => {
    const workspaces = tx.objectStore("workspaces");
    const key = guestTarget(guest);
    const read = workspaces.get(key);
    read.onsuccess = () => {
      if (read.result && (read.result.account !== account || read.result.nextGuest !== nextGuest)) {
        fail(new Error("This workspace was already claimed in another tab."));
        return;
      }
      readGuestDocuments(tx, guest, (docs) => {
        try {
          const metadata = read.result ? read.result.metadata : snapshot(docs);
          if (!read.result) workspaces.put({ account, nextGuest, metadata }, key);
          done({ docs, metadata });
        } catch (error) {
          fail(error);
        }
      });
    };
  });
}

function resolveGuest(workspaces, guest, done) {
  const read = workspaces.get(guestTarget(guest));
  read.onsuccess = () => {
    if (read.result) resolveGuest(workspaces, read.result.nextGuest, done);
    else done(guest);
  };
}

export function withGuestTarget(guest, action) {
  return transact("readwrite", "workspaces", (tx, done, fail) => {
    resolveGuest(tx.objectStore("workspaces"), guest, (target) => {
      try {
        done(action(target));
      } catch (error) {
        fail(error);
      }
    });
  });
}

function changeGuestDocument(guest, id, update) {
  return transact("readwrite", stores, (tx, done) => {
    const workspaces = tx.objectStore("workspaces");
    resolveGuest(workspaces, guest ?? null, (target) => {
      const store = target ? workspaces : tx.objectStore("documents");
      const read = store.get(target ?? id);
      read.onsuccess = () => {
        const current = target ? read.result?.[id] : read.result;
        const result = update(current);
        if (target) store.put({ ...read.result, [result.doc.id]: result.doc }, target);
        else if (current && !result.concurrentCopy) store.put(result.doc);
        else store.add(result.doc);
        done(result);
      };
    });
  });
}

export function saveDocument(doc, guest) {
  return changeGuestDocument(guest, doc.id, () => ({ doc }));
}

export function signedDocument(current, base, signed, conflict = current && (current.revision ?? 0) !== (base.revision ?? 0)) {
  return {
    doc: {
      id: conflict ? createDocumentId() : base.id,
      name: conflict
        ? base.name.replace(/(?:\.pdf)?$/i, " (separate copy).pdf")
        : base.name,
      file: base.file,
      ...(base.inkColor ? { inkColor: base.inkColor } : {}),
      pages: base.pages,
      revision: conflict ? 1 : (base.revision ?? 0) + 1,
      updated: Date.now(),
      signed,
    },
    concurrentCopy: conflict ? current : null,
  };
}

export function saveSignedDocument(base, signed, guest) {
  return changeGuestDocument(guest, base.id, (current) => signedDocument(current, base, signed));
}

const accountStores = ["workspaces", "account-records"];
const initialState = () => ({ revision: 0, base: {}, versions: {}, documents: {} });

export function getAccountState(account) {
  return transact("readonly", "workspaces", (tx, done) => {
    const read = tx.objectStore("workspaces").get(account);
    read.onsuccess = () => done(read.result ?? initialState());
  });
}

export function changeAccount(account, keys, update) {
  return transact(update ? "readwrite" : "readonly", accountStores, (tx, done, fail) => {
    const workspaces = tx.objectStore("workspaces");
    const store = tx.objectStore("account-records");
    const read = workspaces.get(account);
    read.onsuccess = () => {
      const state = read.result ?? initialState();
      const records = {};
      const requested = keys ?? Object.keys(state.versions);
      function complete() {
        if (!update) {
          done({ ...state, records });
          return;
        }
        try {
          const { changes = {}, revision = state.revision, base = state.base, importedGuest = state.importedGuest } = update(state, records);
          for (const [key, record] of Object.entries(changes)) {
            if (record) {
              store.put(record, [account, key]);
              state.versions[key] = record.version;
              if (key.startsWith("document:")) state.documents[key] = record.value.revision ?? 0;
            } else {
              store.delete([account, key]);
              delete state.versions[key];
              delete state.documents[key];
            }
          }
          const next = { ...state, revision, base };
          if (importedGuest) next.importedGuest = importedGuest;
          workspaces.put(next, account);
          done({ ...next, changes });
        } catch (error) {
          fail(error);
        }
      }
      let remaining = requested.length;
      if (!remaining) complete();
      for (const key of requested) {
        const item = store.get([account, key]);
        item.onsuccess = () => {
          if (item.result) records[key] = item.result;
          if (!--remaining) complete();
        };
      }
    };
  });
}
