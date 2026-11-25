import { changeAccount, claimGuestDocuments, getAccountState, signedDocument, withGuestTarget } from "./db.js";
import { readDraft, validateDraft } from "./drafts.js";
import { createDocumentId } from "./document-id.js";

export const signatureKey = "inkdesk-signature";
export const accountKey = "inkdesk-account";
export const guestKey = "inkdesk-guest";
const empty = { revision: 0, base: {}, versions: {}, documents: {}, records: {} };
const entry = (value) => ({ version: createDocumentId(), value });
const documentKey = (id) => `document:${id}`;
const draftKey = (doc) => `draft:${doc.id}:${doc.revision ?? 0}`;

export function localValue(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function guestStorage(guest) {
  if (!guest) return localStorage;
  return {
    getItem: (key) => localStorage.getItem(`${guest}:${key}`),
    setItem: (key, value) => localStorage.setItem(`${guest}:${key}`, value),
    removeItem: (key) => localStorage.removeItem(`${guest}:${key}`),
  };
}

export async function api(path, { method = "GET", body, account, revision, timeout = 45_000 } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (account) headers["X-Inkdesk-Account"] = account;
  if (revision) headers["If-None-Match"] = `"${revision}"`;
  const response = await fetch(`/api/${path}`, {
    method, headers, body: JSON.stringify(body), cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (response.status === 304) return null;
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw Object.assign(new Error(result?.error || "The account service could not complete the request."), {
      status: response.status,
    });
  }
  const result = await response.json();
  return result;
}

function encodeBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function encodeDocument(doc) {
  const { file, signed, temporary, accountVersion, ...info } = doc;
  return {
    ...info,
    file: await encodeBlob(file),
    signed: signed ? await encodeBlob(signed) : undefined,
  };
}

function decodeDocument(doc, accountVersion) {
  const pdf = (data) => {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: "application/pdf" });
  };
  return { ...doc, accountVersion, file: pdf(doc.file), signed: doc.signed ? pdf(doc.signed) : undefined };
}

export async function writeGuestStorage(guest, action) {
  try {
    return await withGuestTarget(guest, (target) => action(guestStorage(target)));
  } catch (error) {
    if (error.code !== "storage-blocked" && error.name !== "SecurityError" && error.name !== "ReferenceError") throw error;
    return action(guestStorage(localValue(guestKey) ?? guest));
  }
}

export async function importGuest(workspace, guest, nextGuest, rotate) {
  if ((await getAccountState(workspace.key)).importedGuest === nextGuest) {
    rotate();
    return;
  }
  const { docs, metadata } = await claimGuestDocuments(guest, nextGuest, workspace.key, (documents) => {
    const storage = guestStorage(guest);
    const signature = JSON.parse(storage.getItem(signatureKey));
    const drafts = Object.fromEntries(documents.flatMap((doc) => {
      const marks = readDraft(doc, storage);
      return marks.length ? [[draftKey(doc), entry(marks)]] : [];
    }));
    return signature ? { ...drafts, signature: entry(signature) } : drafts;
  });
  rotate();
  const records = { ...metadata };
  for (const doc of docs) {
    records[documentKey(doc.id)] = entry(await encodeDocument(doc));
  }
  await workspace.seed(records, nextGuest);
}

function changedRecords(before, after) {
  return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key]?.version !== after[key]?.version)
    .map((key) => [key, after[key] ?? null]));
}

function draftCopy(doc, id = createDocumentId()) {
  return { ...doc, id, name: doc.name.replace(/(?:\.pdf)?$/i, " (separate copy).pdf") };
}

export function mergeRecords(base, local, remote) {
  const merged = { ...remote };
  const keys = new Set([...Object.keys(local), ...Object.keys(base)]);
  const movedDrafts = new Set();
  for (const key of keys) {
    if (local[key]?.version === base[key] || !key.startsWith("document:")) continue;
    if (local[key] && remote[key] && remote[key].version !== base[key] &&
        remote[key].version !== local[key].version) {
      const doc = local[key].value;
      const localDraftKey = draftKey(doc);
      const copy = draftCopy(doc, local[localDraftKey]?.version);
      merged[documentKey(copy.id)] = entry(copy);
      movedDrafts.add(localDraftKey);
      if (local[localDraftKey]) merged[draftKey(copy)] = local[localDraftKey];
    } else if (local[key]) {
      merged[key] = local[key];
    } else {
      delete merged[key];
    }
  }
  for (const key of keys) {
    if (key.startsWith("document:") || movedDrafts.has(key) || local[key]?.version === base[key]) continue;
    const draft = local[key];
    if (draft && key.startsWith("draft:")) {
      const [, id] = key.split(":");
      const doc = local[documentKey(id)]?.value;
      const next = merged[documentKey(id)]?.value;
      if (doc && draftKey(doc) === key && (!next || draftKey(next) !== key)) {
        const copy = draftCopy(doc, draft.version);
        merged[documentKey(copy.id)] = entry(copy);
        merged[draftKey(copy)] = draft;
        continue;
      }
    }
    if (draft) merged[key] = draft;
    else delete merged[key];
  }
  return merged;
}

export class AccountWorkspace {
  constructor(account) {
    this.account = account;
    this.key = `account:${account.id}`;
    this.cache = empty;
    this.documents = new Map();
  }

  async load() {
    this.cache = await changeAccount(this.key, null);
  }

  async seed(records, importedGuest) {
    const saved = await changeAccount(this.key, [], (state) => {
      if (importedGuest && state.importedGuest === importedGuest) return {};
      return {
        importedGuest,
        changes: Object.fromEntries(Object.entries(records).filter(([key]) => !state.versions[key])),
      };
    });
    this.apply(saved);
    await this.refresh(saved);
  }

  getDocuments() {
    const next = new Map();
    for (const [key, record] of Object.entries(this.cache.records)) {
      if (!key.startsWith("document:")) continue;
      const cached = this.documents.get(key);
      next.set(key, cached?.version === record.version
        ? cached : { version: record.version, doc: decodeDocument(record.value, record.version) });
    }
    this.documents = next;
    return [...next.values()].map(({ doc }) => doc);
  }

  getSignature() {
    return this.cache.records.signature?.value ?? null;
  }

  readDraft(doc, handle) {
    const record = this.cache.records[draftKey(doc)];
    if (handle) handle.version = record?.version;
    return validateDraft(doc, record?.value ?? []);
  }

  apply({ changes, ...state }) {
    const records = { ...this.cache.records };
    for (const [key, record] of Object.entries(changes)) {
      if (record) records[key] = record;
      else delete records[key];
    }
    this.cache = { ...state, records };
  }

  async update(keys, transform, notify = true) {
    const saved = await changeAccount(this.key, keys, transform);
    this.apply(saved);
    if (notify) this.onChange?.();
    this.onWrite?.();
  }

  saveSignature(signature) {
    return this.update([], () => ({ changes: { signature: entry(signature) } }));
  }

  async saveDocument(doc) {
    const value = await encodeDocument(doc);
    return this.update([], () => ({ changes: { [documentKey(doc.id)]: entry(value) } }));
  }

  removeDocument(doc) {
    return this.update([], (state) => ({
      changes: Object.fromEntries(Object.keys(state.versions)
        .filter((key) => key === documentKey(doc.id) || key.startsWith(`draft:${doc.id}:`))
        .map((key) => [key, null])),
    }));
  }

  async saveSignedDocument(base, signed, handle = {}) {
    const encoded = await encodeBlob(signed);
    const original = this.cache.records[documentKey(base.id)]?.value.file ?? await encodeBlob(base.file);
    const copyId = handle.copyId ?? handle.version;
    const keys = [documentKey(base.id), ...(copyId ? [documentKey(copyId)] : [])];
    let result;
    await this.update(keys, (_state, records) => {
      const copy = copyId && records[documentKey(copyId)]?.value;
      const source = copy ? { ...base, id: copy.id, name: copy.name } : base;
      const current = records[documentKey(source.id)];
      const advanced = current && ((current.value.revision ?? 0) !== (base.revision ?? 0) ||
        (!copy && base.accountVersion && base.accountVersion !== current.version));
      result = signedDocument(current?.value, source, signed, advanced);
      if (current) result.concurrentVersion = current.version;
      const doc = { ...result.doc, file: original, signed: encoded };
      return { changes: { [documentKey(doc.id)]: entry(doc), [draftKey(source)]: null } };
    });
    if (result.concurrentCopy) result.concurrentCopy = decodeDocument(result.concurrentCopy, result.concurrentVersion);
    const saved = this.cache.records[documentKey(result.doc.id)];
    return { ...result, doc: { ...result.doc, accountVersion: saved.version } };
  }

  async writeDraft(doc, marks, handle = {}) {
    if (doc.temporary) return;
    const originalKey = documentKey(doc.id);
    const revision = doc.revision ?? 0;
    let copyId = handle.copyId ?? handle.version ?? createDocumentId();
    let copyKey = documentKey(copyId);
    const stamp = marks.length ? entry(marks) : null;
    // A stale editor keeps the exact source PDF, including any earlier signatures.
    let source;
    let copied = false;
    let needsSource = false;
    const save = () => this.update([], (state) => {
      if (state.documents[copyKey] === revision) {
        copied = true;
        return { changes: { [draftKey({ id: copyId, revision })]: stamp } };
      }
      if (!handle.copyId && state.documents[originalKey] === revision &&
          (!doc.accountVersion || doc.accountVersion === state.versions[originalKey])) {
        return { changes: { [draftKey(doc)]: stamp } };
      }
      if (!stamp) return { changes: { [draftKey(doc)]: null } };
      if (state.documents[copyKey] !== undefined) {
        copyId = createDocumentId();
        copyKey = documentKey(copyId);
        source = undefined;
      }
      if (!source) {
        needsSource = true;
        return {};
      }
      copied = true;
      return { changes: { [copyKey]: entry(source), [draftKey(source)]: stamp, [draftKey(doc)]: null } };
    }, false);

    do {
      needsSource = false;
      await save();
      if (needsSource) source = draftCopy(await encodeDocument(doc), copyId);
    } while (needsSource);
    if (copied) {
      handle.copyId = copyId;
      this.onChange?.();
    }
    handle.version = stamp?.version;
  }

  sync() {
    if (!this.pending) {
      const run = () => this.reconcile();
      this.pending = (navigator.locks?.request(this.key, run) ?? run())
        .finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  async pull(state) {
    const remote = await api("records", { account: this.account.id, revision: state.revision });
    if (!remote) return;
    const fetched = {};
    for (const [key, version] of Object.entries(remote.versions)) {
      if (state.base[key] === version) continue;
      const query = new URLSearchParams({ key, version });
      const { record } = await api(`record?${query}`, { account: this.account.id });
      fetched[key] = record;
    }
    const saved = await changeAccount(this.key, null, (latest, local) => {
      if (latest.revision >= remote.revision) return {};
      // An unchanged remote item needs its body only if there is no local edit.
      const records = Object.fromEntries(Object.entries(remote.versions).map(([key, version]) => [
        key, fetched[key] ?? (local[key]?.version === version ? local[key] : { version }),
      ]));
      return {
        revision: remote.revision,
        base: remote.versions,
        changes: changedRecords(local, mergeRecords(latest.base, local, records)),
      };
    });
    // The transaction may have incorporated edits from another browser tab.
    await this.refresh(saved);
  }

  async refresh(state = this.cache) {
    const keys = [...new Set([...Object.keys(state.versions), ...Object.keys(this.cache.records)])]
      .filter((key) => state.versions[key] !== this.cache.records[key]?.version);
    if (!keys.length) return;
    const { records, ...latest } = await changeAccount(this.key, keys);
    this.apply({ ...latest, changes: Object.fromEntries(keys.map((key) => [key, records[key] ?? null])) });
    this.onChange?.();
  }

  async reconcile() {
    const account = this.account.id;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        let state = await getAccountState(this.key);
        await this.refresh(state);
        await this.pull(state);
        state = await getAccountState(this.key);
        const keys = [...new Set([...Object.keys(state.versions), ...Object.keys(state.base)])];
        // Publish a document before publishing any drafts that refer to it.
        keys.sort((a, b) => Number(!a.startsWith("document:")) - Number(!b.startsWith("document:")));
        const rejected = this.rejected ??= new Map();
        for (const key of keys) {
          const version = state.versions[key];
          if (state.base[key] === version || (rejected.has(key) && rejected.get(key) === version)) continue;
          if (key.startsWith("draft:") && version) {
            const [, id, revision] = key.split(":");
            const parent = documentKey(id);
            if (state.documents[parent] !== Number(revision) || state.base[parent] !== state.versions[parent]) continue;
          }
          const { records, revision, versions } = await changeAccount(this.key, [key]);
          if (revision !== state.revision || versions[key] !== version) {
            throw Object.assign(new Error("Sync changed in another tab."), { status: 409 });
          }
          const query = new URLSearchParams({ key });
          let saved;
          try {
            saved = await api(`record?${query}`, { method: "PUT", account, body: { revision, record: records[key] ?? null } });
          } catch (error) {
            if (error.status !== 413) throw error;
            rejected.set(key, version);
            continue;
          }
          rejected.delete(key);
          state = await changeAccount(this.key, [], (latest) => {
            if (latest.revision >= saved.revision) return {};
            const next = { ...latest.base };
            if (version) next[key] = version;
            else delete next[key];
            return { revision: saved.revision, base: next };
          });
        }
        state = await getAccountState(this.key);
        if ([...rejected].some(([key, version]) => state.versions[key] === version && state.base[key] !== version)) {
          throw Object.assign(new Error("Some workspace items exceed the sync size limit."), { status: 413 });
        }
        if ([...new Set([...Object.keys(state.versions), ...Object.keys(state.base)])].some((key) => state.versions[key] !== state.base[key])) continue;
        return;
      } catch (error) {
        if (error.status !== 409) throw error;
      }
    }
    throw new Error("Workspace sync is busy. Try again shortly.");
  }
}
