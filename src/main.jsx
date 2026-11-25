import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PenTool,
  LayoutGrid,
  FolderClosed,
  LockKeyhole,
  ArrowRight,
  FileText,
  FileUp,
  PenLine,
  Download,
  Plus,
  Upload,
  FolderOpen,
  Clock3,
  X,
  Check,
  Search,
  LoaderCircle,
  ChevronRight,
  CircleHelp,
  UserRound,
  Trash2,
} from "lucide-react";
import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource/allura/latin-400.css";
import "./style.css";
import { getDocuments, saveDocument, saveSignedDocument } from "./db";
import { downloadPDF } from "./download";
import { pdfOpenErrorMessage } from "./pdf-errors";
import { createDocumentId } from "./document-id";
import { importDocuments, documentGroups } from "./bundles";
import Editor from "./Editor";
import AccountDialog, { AccountRoot, useAccountSync } from "./Account";
import { guestStorage, signatureKey, writeGuestStorage } from "./account";
import InstallApp from "./InstallApp";
import SignatureModal, { Dialog } from "./Signature";

function Artwork() {
  return (
    <div className="hero-art" aria-hidden="true">
      <div className="orbit one" />
      <div className="orbit two" />
      <div className="orbit three" />
      <i className="star star-one">✦</i>
      <i className="star star-two">✧</i>
      <i className="star star-three">✦</i>
      <div className="paper-shadow" />
      <div className="art-paper back-sheet" />
      <div className="art-paper front-sheet">
        <div className="fold" />
        <div className="ink-line title-line" />
        <div className="ink-line l2" />
        <div className="ink-line l3" />
        <div className="ink-line l4" />
        <div className="art-sign">Avery</div>
        <div className="sign-rule" />
      </div>
      <div className="art-pen">
        <div className="pen-end" />
        <div className="pen-body" />
        <div className="pen-grip" />
        <div className="pen-nib" />
        <div className="pen-clip" />
      </div>
      <div className="signed-seal">
        <Check strokeWidth={3} size={22} />
      </div>
    </div>
  );
}
function Brand() {
  return (
    <span className="brand">
      <span className="brand-icon">
        <img src="/inkdesk.svg" alt="" />
      </span>
      Inkdesk
    </span>
  );
}
function App({ accountWorkspace, guest, authenticate, signOut }) {
  const [tab, setTab] = useState("workspace"),
    [docs, setDocs] = useState([]),
    [loaded, setLoaded] = useState(false),
    [editor, setEditor] = useState(null),
    [activeBundle, setActiveBundle] = useState(null),
    [busy, setBusy] = useState(false),
    [drag, setDrag] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [sigModal, setSigModal] = useState(false),
    [help, setHelp] = useState(false),
    [accountOpen, setAccountOpen] = useState(false),
    [removeDoc, setRemoveDoc] = useState(null),
    [removing, setRemoving] = useState(false),
    [removeError, setRemoveError] = useState(""),
    [query, setQuery] = useState("");
  const [signature, setSignature] = useState(() => {
    try {
      return accountWorkspace ? accountWorkspace.getSignature() :
        JSON.parse(guestStorage(guest).getItem(signatureKey));
    } catch {
      return null;
    }
  });
  const [temporarySignature, setTemporarySignature] = useState(false);
  const fileInput = useRef(),
    afterSig = useRef(null),
    lock = useRef(false),
    dragDepth = useRef(0);
  const syncStatus = useAccountSync(accountWorkspace, () => {
    const stored = accountWorkspace.getDocuments();
    const ids = new Set(stored.map((doc) => doc.id));
    setDocs((local) => [...stored, ...local.filter((doc) => doc.temporary && !ids.has(doc.id))]);
    if (!temporarySignature) setSignature(accountWorkspace.getSignature());
    setLoaded(true);
  });
  useEffect(() => {
    (accountWorkspace ? Promise.resolve(accountWorkspace.getDocuments()) : getDocuments(guest))
      .then((stored) =>
        setDocs((local) => [
          ...local,
          ...stored.filter((doc) => !local.some((item) => item.id === doc.id)),
        ]),
      )
      .catch((failure) => setError(failure.code === "storage-blocked" ? failure.message :
        "Browser storage is unavailable. Allow site storage to keep documents here."))
      .finally(() => setLoaded(true));
  }, [accountWorkspace, guest]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  function editSignature(callback) {
    afterSig.current = callback || null;
    setSigModal(true);
  }
  async function saveSig(sig) {
    try {
      if (accountWorkspace) await accountWorkspace.saveSignature(sig);
      else await writeGuestStorage(guest, (storage) => storage.setItem(signatureKey, JSON.stringify(sig)));
      setTemporarySignature(false);
      setToast("Signature saved");
    } catch {
      setTemporarySignature(true);
      setError(
        "Browser storage is unavailable. Your signature is available in this tab until you reload.",
      );
    }
    setSignature(sig);
    setSigModal(false);
    afterSig.current?.();
    afterSig.current = null;
  }
  function updateDoc(doc) {
    setDocs((all) => [doc, ...all.filter((d) => d.id !== doc.id)]);
  }
  function closeEditor() {
    if (editor) editor.pdf.loadingTask.destroy();
    setEditor(null);
    if (editor?.doc.bundleId) {
      setActiveBundle(editor.doc.bundleId);
      setTab("documents");
      setQuery("");
    }
    window.scrollTo(0, 0);
  }
  async function open(file, existing) {
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    let pdf;
    try {
      if (
        !existing &&
        !/\.pdf$/i.test(file.name) &&
        file.type !== "application/pdf"
      )
        throw new Error("Choose a PDF file to continue.");
      const { openPDF } = await import("./pdf");
      pdf = await openPDF(file);
      const { loadForSigning } = await import("./signing");
      await loadForSigning(file);
      const doc = existing || {
        id: createDocumentId(),
        name: file.name,
        file,
        updated: Date.now(),
        pages: pdf.numPages,
      };
      if (!existing) {
        try {
          if (accountWorkspace) await accountWorkspace.saveDocument(doc);
          else await saveDocument(doc, guest);
        } catch {
          doc.temporary = true;
          setError(
            "Browser storage is unavailable. You can still sign this PDF and download it in this tab.",
          );
        }
        updateDoc(doc);
      }
      setEditor({ doc, pdf, source: file });
      window.scrollTo(0, 0);
    } catch (e) {
      pdf?.loadingTask.destroy();
      setError(pdfOpenErrorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function upload(files) {
    const selected = Array.from(files || []);
    if (!selected.length || lock.current) return;
    if (selected.length === 1) {
      setActiveBundle(null);
      return open(selected[0]);
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const { openPDF } = await import("./pdf");
      const { loadForSigning } = await import("./signing");
      const { documents, errors } = await importDocuments(selected, {
        openPDF, validate: loadForSigning,
        save: (doc) => accountWorkspace ? accountWorkspace.saveDocument(doc) : saveDocument(doc, guest),
        onDocument: updateDoc,
      });
      if (documents.length) {
        setActiveBundle(documents[0].bundleId);
        setTab("documents");
        setQuery("");
      }
      const messages = errors.map(({ name, error }) => `${name}: ${pdfOpenErrorMessage(error)}`);
      if (documents.some((doc) => doc.temporary)) messages.push("Some documents are available in this tab only. Download them before reloading.");
      setError(messages.join(" "));
    } catch (error) {
      setError(pdfOpenErrorMessage(error));
    } finally {
      lock.current = false;
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function trySample() {
    try {
      const { sampleFile } = await import("./pdf");
      await open(await sampleFile());
    } catch {
      setError("The sample could not be opened. Please try again.");
    }
  }
  async function exportDoc(signed, settings, draftHandle) {
    const base = { ...editor.doc, inkColor: settings.inkColor };
    try {
      const { doc, concurrentCopy } = await (accountWorkspace
        ? accountWorkspace.saveSignedDocument(base, signed, draftHandle)
        : saveSignedDocument(base, signed, guest));
      if (concurrentCopy) updateDoc(concurrentCopy);
      updateDoc(doc);
      setToast(
        concurrentCopy
          ? "The document changed while you were editing. Both copies are in Documents."
          : "Signed PDF saved",
      );
    } catch {
      updateDoc({
        ...editor.doc,
        inkColor: settings.inkColor,
        signed,
        updated: Date.now(),
        temporary: true,
      });
      setError(
        "Your download is ready. Browser storage is unavailable, so this signed copy is available here until you reload.",
      );
    }
  }
  async function removeDocument() {
    setRemoving(true);
    setRemoveError("");
    try {
      await accountWorkspace.removeDocument(removeDoc);
      setDocs((all) => all.filter((doc) => doc.id !== removeDoc.id));
      setToast("PDF removed");
      setRemoveDoc(null);
    } catch {
      setRemoveError("The PDF could not be removed. Try again.");
    } finally {
      setRemoving(false);
    }
  }
  function docList(all) {
    const groups = documentGroups(docs);
    const visible = all
      ? groups.filter((group) => (!activeBundle || group.id === activeBundle) &&
          (group.name?.toLowerCase().includes(query.trim().toLowerCase()) ||
           group.documents.some((doc) => doc.name.toLowerCase().includes(query.trim().toLowerCase()))))
      : groups.slice(0, 4);
    const rows = visible.flatMap((group) => [
      ...(group.name ? [{ header: true, id: group.id, name: group.name, count: group.documents.length }] : []),
      ...group.documents,
    ]);
    return (
      <div className="card documents-card">
        {rows.length ? (
          <div className="rows">
            {rows.map((d) => d.header ? (
              <div className="bundle-heading" key={`bundle-${d.id}`}>
                <FolderClosed size={20} />
                <div><strong>{d.name}</strong><small>{d.count} documents · Downloaded as separate PDFs</small></div>
              </div>
            ) : (
              <div className="doc-row" key={d.id}>
                <span className="doc-icon">
                  <FileText size={22} />
                </span>
                <button
                  disabled={busy}
                  className="doc-name"
                  onClick={() => { setActiveBundle(d.bundleId || null); open(d.signed || d.file, d); }}
                >
                  <strong>{d.name}</strong>
                  <small>
                    {d.temporary && "This tab only · "}
                    {d.pages} {d.pages === 1 ? "page" : "pages"} ·{" "}
                    {new Date(d.updated).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </small>
                </button>
                <span className={"status " + (d.signed ? "done" : "")}>
                  {d.signed ? "Signed" : "Ready to sign"}
                </span>
                {d.signed ? (
                  <button
                    className="icon-button"
                    aria-label={"Download signed " + d.name}
                    onClick={() => downloadPDF(d.signed, d.name)}
                  >
                    <Download size={17} />
                  </button>
                ) : (
                  <button
                    className="icon-button"
                    disabled={busy}
                    aria-label={"Open " + d.name}
                    onClick={() => { setActiveBundle(d.bundleId || null); open(d.signed || d.file, d); }}
                  >
                    <ChevronRight size={17} />
                  </button>
                )}
                {all && accountWorkspace && (
                  <button className="icon-button" aria-label={`Remove ${d.name}`}
                    onClick={() => { setRemoveError(""); setRemoveDoc(d); }}>
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-docs">
            <div className="empty-folder">
              <FolderOpen size={25} strokeWidth={1.5} />
            </div>
            <div>
              <strong>
                {!loaded
                  ? "Loading documents…"
                  : query && all
                    ? "No matching documents"
                    : "No documents yet"}
              </strong>
              <p>
                {query && all
                  ? "Try a different file name."
                  : "Your uploaded and signed PDFs will appear here."}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      <header className="topbar">
        <div className="nav-inner">
          <div className="brand-group">
            <Brand />
            <span className="brand-separator" />
            {!editor && (
              <nav aria-label="Main navigation">
                <button
                  className={tab === "workspace" ? "nav-active" : ""}
                  onClick={() => { setActiveBundle(null); setTab("workspace"); }}
                >
                  <LayoutGrid size={15} />
                  Workspace
                </button>
                <button
                  className={tab === "documents" ? "nav-active" : ""}
                  onClick={() => { setActiveBundle(null); setTab("documents"); }}
                >
                  <FolderClosed size={16} />
                  Documents
                </button>
              </nav>
            )}
            {editor && <span className="editor-nav">Document editor</span>}
          </div>
          <div className="header-end">
            <InstallApp />
            <span className="privacy">
              <i />
              {accountWorkspace ? syncStatus : "Local workspace"}
            </span>
            {!editor && (
              <button className="account-button" disabled={busy || !loaded} onClick={() => setAccountOpen(true)}>
                <UserRound size={15} />
                {accountWorkspace ? "Account" : "Claim workspace"}
              </button>
            )}
            <button
              className="help-button"
              aria-label="How to use Inkdesk"
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => upload(e.target.files)}
      />
      {editor ? (
        <Editor
          {...editor}
          signature={signature}
          editSignature={editSignature}
          onClose={closeEditor}
          onExport={exportDoc}
          accountWorkspace={accountWorkspace}
          guest={guest}
        />
      ) : (
        <main className="workspace">
          {tab === "workspace" ? (
            <>
              <section className="hero">
                <div className="hero-text">
                  <h1>
                    Your signing desk<span>.</span>
                  </h1>
                  <p>Sign your PDFs and save a fresh copy, all in one place.</p>
                  <div className="workflow">
                    <span>
                      <Upload />
                      Upload
                    </span>
                    <ArrowRight />
                    <span>
                      <PenLine />
                      Sign
                    </span>
                    <ArrowRight />
                    <span>
                      <Download />
                      Download
                    </span>
                  </div>
                </div>
                <Artwork />
              </section>
              <div className="main-grid">
                <section className="card upload-card">
                  <div className="card-title">
                    <span className="tile violet">
                      <FileUp />
                    </span>
                    <h2>Upload PDFs</h2>
                  </div>
                  <p className="card-desc">Choose one PDF or several to create a bundle.</p>
                  <div
                    className={"dropzone " + (drag ? "dragging" : "")}
                    onDragOver={(e) => e.preventDefault()}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      dragDepth.current++;
                      setDrag(true);
                    }}
                    onDragLeave={() => {
                      if (--dragDepth.current <= 0) setDrag(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dragDepth.current = 0;
                      setDrag(false);
                      upload(e.dataTransfer.files);
                    }}
                  >
                    <div className="upload-graphic" aria-hidden="true">
                      <i />
                      <span>
                        <FileText size={30} strokeWidth={1.5} />
                        <b>
                          <Plus size={12} strokeWidth={3} />
                        </b>
                      </span>
                    </div>
                    <strong>
                      {busy
                        ? "Opening your PDFs…"
                        : drag
                          ? "Release to open your PDFs"
                          : "Drop your PDFs here"}
                    </strong>
                    <small>or select files from your device</small>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => fileInput.current.click()}
                    >
                      {busy ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <Upload size={16} />
                      )}
                      Choose PDFs
                    </button>
                  </div>
                  <div className="upload-foot">
                    <span>
                      <LockKeyhole size={13} />
                      {accountWorkspace ? "Syncs to your account" : "Your files stay on your device"}
                    </span>
                    <button
                      disabled={busy}
                      onClick={trySample}
                      className="text-button"
                    >
                      Try a sample <ArrowRight size={13} />
                    </button>
                  </div>
                </section>
                <section className="card sig-card">
                  <div className="card-title">
                    <span className="tile peach">
                      <PenTool />
                    </span>
                    <h2>Your signature</h2>
                  </div>
                  <p className="card-desc">Save your handwriting. Every placement gets a natural variation.</p>
                  <div className="sig-preview">
                    <div className="signature-line">
                      <span>×</span>
                    </div>
                    {signature ? (
                      <img
                        className="saved-image"
                        src={signature.image}
                        alt="Your saved signature"
                      />
                    ) : (
                      <span className="hand sample-sign">Your signature</span>
                    )}
                    <span className="sig-label">
                      {temporarySignature
                        ? "THIS TAB ONLY"
                        : signature
                          ? "SAVED SIGNATURE"
                          : "SIGNATURE PREVIEW"}
                    </span>
                  </div>
                  <button
                    className="secondary full"
                    onClick={() => editSignature()}
                  >
                    {signature ? <PenLine size={16} /> : <Plus size={17} />}{" "}
                    {signature ? "Manage signatures" : "Create signature"}
                  </button>
                </section>
              </div>
              <section className="recent">
                <div className="section-heading">
                  <h2>
                    <Clock3 size={19} />
                    Recent documents
                  </h2>
                  <button
                    className="text-button"
                    onClick={() => { setActiveBundle(null); setTab("documents"); }}
                  >
                    View all <ArrowRight size={14} />
                  </button>
                </div>
                {docList(false)}
              </section>
            </>
          ) : (
            <section className="library">
              <div className="library-head">
                <div>
                  <h1>{activeBundle ? "Document bundle" : "Documents"}</h1>
                  {activeBundle && <button className="text-button" onClick={() => setActiveBundle(null)}>View all documents</button>}
                  <p>{accountWorkspace ? "Your PDFs in this account." : "Your PDFs on this device."}</p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => fileInput.current.click()}
                >
                  <Upload size={16} />
                  Upload PDFs
                </button>
              </div>
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="Search documents"
                  placeholder="Search documents"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              {docList(true)}
            </section>
          )}
        </main>
      )}
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="icon-button"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {sigModal && (
        <SignatureModal
          close={() => setSigModal(false)}
          onSave={saveSig}
          existing={signature}
        />
      )}
      {removeDoc && (
        <Dialog title="Remove this PDF?" close={() => { if (!removing) setRemoveDoc(null); }}>
          <p className="modal-copy"><strong>{removeDoc.name}</strong> and its saved drafts will be removed from your account.</p>
          {removeError && <p className="account-error" role="alert">{removeError}</p>}
          <div className="modal-actions">
            <button className="secondary" disabled={removing} onClick={() => setRemoveDoc(null)}>Cancel</button>
            <button className="primary" disabled={removing} onClick={removeDocument}>Remove PDF</button>
          </div>
        </Dialog>
      )}
      {accountOpen && (
        <AccountDialog workspace={accountWorkspace} status={syncStatus} authenticate={authenticate}
          signOut={signOut} close={() => setAccountOpen(false)} />
      )}
      {help && (
        <Dialog title="Signing with Inkdesk" close={() => setHelp(false)}>
          <ol className="guide">
            <li>
              Choose one or more PDFs from your device or drop them onto the workspace. Multiple PDFs form a bundle; open and download each document separately.
            </li>
            <li>
              Draw or type your signature. Click where it belongs on the page,
              then drag or resize it.
            </li>
            <li>
              Download the signed PDF. Claim your workspace to access your documents and signature on other devices.
            </li>
          </ol>
          <button className="primary full" onClick={() => setHelp(false)}>
            Got it
          </button>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<AccountRoot Workspace={App} />);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Offline support is unavailable", error);
    });
  });
}
