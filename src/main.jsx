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
} from "lucide-react";
import "@fontsource-variable/dm-sans/wght.css";
import "@fontsource/allura/latin-400.css";
import "./style.css";
import { getDocuments, saveDocument, saveSignedDocument } from "./db";
import { downloadPDF } from "./download";
import { pdfOpenErrorMessage } from "./pdf-errors";
import { createDocumentId } from "./document-id";
import Editor from "./Editor";
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
function App() {
  const [tab, setTab] = useState("workspace"),
    [docs, setDocs] = useState([]),
    [loaded, setLoaded] = useState(false),
    [editor, setEditor] = useState(null),
    [busy, setBusy] = useState(false),
    [drag, setDrag] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [sigModal, setSigModal] = useState(false),
    [help, setHelp] = useState(false),
    [query, setQuery] = useState("");
  const [signature, setSignature] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("inkdesk-signature"));
    } catch {
      return null;
    }
  });
  const [temporarySignature, setTemporarySignature] = useState(false);
  const fileInput = useRef(),
    afterSig = useRef(null),
    lock = useRef(false),
    dragDepth = useRef(0);
  useEffect(() => {
    getDocuments()
      .then((stored) =>
        setDocs((local) => [
          ...local,
          ...stored.filter((doc) => !local.some((item) => item.id === doc.id)),
        ]),
      )
      .catch(() =>
        setError(
          "Browser storage is unavailable. Allow site storage to keep documents here.",
        ),
      )
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4200);
    return () => clearTimeout(t);
  }, [toast]);
  function editSignature(callback) {
    afterSig.current = callback || null;
    setSigModal(true);
  }
  function saveSig(sig) {
    try {
      localStorage.setItem("inkdesk-signature", JSON.stringify(sig));
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
          await saveDocument(doc);
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
  async function trySample() {
    try {
      const { sampleFile } = await import("./pdf");
      await open(await sampleFile());
    } catch {
      setError("The sample could not be opened. Please try again.");
    }
  }
  async function exportDoc(signed, settings = {}) {
    try {
      const { doc, concurrentCopy } = await saveSignedDocument(
        { ...editor.doc, inkColor: settings.inkColor },
        signed,
      );
      if (concurrentCopy) updateDoc(concurrentCopy);
      updateDoc(doc);
      setToast(
        concurrentCopy
          ? "Another tab saved changes. Both copies are in Documents."
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
  const sorted = [...docs].sort((a, b) => b.updated - a.updated);
  function docList(all) {
    const rows = all
      ? sorted.filter((d) =>
          d.name.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : sorted.slice(0, 4);
    return (
      <div className="card documents-card">
        {rows.length ? (
          <div className="rows">
            {rows.map((d) => (
              <div className="doc-row" key={d.id}>
                <span className="doc-icon">
                  <FileText size={22} />
                </span>
                <button
                  disabled={busy}
                  className="doc-name"
                  onClick={() => open(d.signed || d.file, d)}
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
                    onClick={() => open(d.signed || d.file, d)}
                  >
                    <ChevronRight size={17} />
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
                  onClick={() => setTab("workspace")}
                >
                  <LayoutGrid size={15} />
                  Workspace
                </button>
                <button
                  className={tab === "documents" ? "nav-active" : ""}
                  onClick={() => setTab("documents")}
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
              Local workspace
            </span>
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
        hidden
        onChange={(e) => open(e.target.files[0])}
      />
      {editor ? (
        <Editor
          {...editor}
          signature={signature}
          editSignature={editSignature}
          onClose={closeEditor}
          onExport={exportDoc}
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
                    <h2>Upload a PDF</h2>
                  </div>
                  <p className="card-desc">Add a document to start signing.</p>
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
                      open(e.dataTransfer.files[0]);
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
                        ? "Opening your PDF…"
                        : drag
                          ? "Release to open your PDF"
                          : "Drop your PDF here"}
                    </strong>
                    <small>or select a file from your device</small>
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
                      Choose PDF
                    </button>
                  </div>
                  <div className="upload-foot">
                    <span>
                      <LockKeyhole size={13} />
                      Your files stay on your device
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
                    onClick={() => setTab("documents")}
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
                  <h1>Documents</h1>
                  <p>Your PDFs on this device.</p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => fileInput.current.click()}
                >
                  <Upload size={16} />
                  Upload PDF
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
      {help && (
        <Dialog title="Signing with Inkdesk" close={() => setHelp(false)}>
          <ol className="guide">
            <li>
              Choose a PDF from your device or drop it onto the workspace.
            </li>
            <li>
              Draw or type your signature. Click where it belongs on the page,
              then drag or resize it.
            </li>
            <li>
              Download the signed PDF. Your signature and documents are saved in
              this browser.
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
createRoot(document.getElementById("root")).render(<App />);
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Offline support is unavailable", error);
    });
  });
}
