import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  PenTool,
  Plus,
  Trash2,
  MousePointer2,
  LoaderCircle,
} from "lucide-react";
import { downloadPDF } from "./download";
import { Dialog } from "./Signature";
import { readDraft, writeDraft, clearDraft } from "./drafts";
import { guestStorage, writeGuestStorage } from "./account";
const clamp = (x, a, b) => Math.min(Math.max(x, a), Math.max(a, b));
export default function Editor({
  doc,
  pdf,
  source,
  signature,
  editSignature,
  onClose,
  onExport,
  accountWorkspace,
  guest,
}) {
  const draftHandle = useRef({});
  const draftQueue = useRef(Promise.resolve());
  const [draft] = useState(() => {
    try {
      return { marks: accountWorkspace ? accountWorkspace.readDraft(doc, draftHandle.current) : readDraft(doc, guestStorage(guest)), error: "" };
    } catch {
      return { marks: [], error: "Your saved draft could not be read. New edits may replace it. Download your signed PDF before leaving." };
    }
  });
  const [draftError, setDraftError] = useState(draft.error);
  const [page, setPage] = useState(draft.marks[0]?.page ?? 1),
    [size, setSize] = useState(null),
    [marks, updateMarks] = useState(draft.marks),
    [selected, select] = useState(null),
    [placing, setPlacing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [leave, setLeave] = useState(false);
  const canvas = useRef(),
    sheet = useRef(),
    drag = useRef(null),
    latest = useRef(Math.max(0, ...draft.marks.map((mark) => mark.id)));
  const marksRef = useRef(draft.marks);
  function persistMarks(marks) {
    const pending = draftQueue.current.catch(() => {}).then(() => accountWorkspace
      ? accountWorkspace.writeDraft(doc, marks, draftHandle.current)
      : writeGuestStorage(guest, (storage) => writeDraft(doc, marks, storage)));
    draftQueue.current = pending;
    pending.then(() => setDraftError(""), () => {
      setDraftError("Your draft could not be saved. Download your signed PDF before leaving or reloading.");
    });
    return pending;
  }
  function setMarks(change, persist = true) {
    const next = typeof change === "function" ? change(marksRef.current) : change;
    marksRef.current = next;
    updateMarks(next);
    if (persist) persistMarks(next);
  }
  function finishDrag() {
    if (!drag.current) return;
    const { moved } = drag.current;
    drag.current = null;
    if (moved) persistMarks(marksRef.current);
  }
  async function keepDraft() {
    finishDrag();
    try {
      await draftQueue.current;
      onClose();
    } catch {
      // The editor shows the save failure and retains the placements.
    }
  }
  useEffect(() => {
    if (!marks.length) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [marks.length]);
  async function discard() {
    try {
      drag.current = null;
      await persistMarks([]);
      onClose();
    } catch {
      setLeave(false);
      setDraftError("The draft could not be discarded. Allow site storage and try again.");
    }
  }
  useEffect(() => {
    let obsolete = false,
      task;
    setSize(null);
    setError("");
    (async () => {
      try {
        const p = await pdf.getPage(page);
        if (obsolete) return;
        const v = p.getViewport({ scale: 1 });
        const v2 = p.getViewport({
          scale: Math.min(2, 1600 / v.width, 2400 / v.height),
        });
        const buffer = document.createElement("canvas");
        buffer.width = Math.ceil(v2.width);
        buffer.height = Math.ceil(v2.height);
        task = p.render({
          canvasContext: buffer.getContext("2d"),
          viewport: v2,
          canvas: buffer,
        });
        await task.promise;
        if (obsolete) return;
        const c = canvas.current;
        c.width = buffer.width;
        c.height = buffer.height;
        c.getContext("2d").drawImage(buffer, 0, 0);
        setSize(v);
      } catch (e) {
        if (!obsolete) setError("This page could not be displayed.");
      }
    })();
    return () => {
      obsolete = true;
      task?.cancel();
    };
  }, [page, pdf]);
  const current = marks.find((m) => m.id === selected && m.page === page);
  function bounded(m, x, y, w) {
    const maxW = Math.min(0.9, (0.9 * m.ratio * size.height) / size.width);
    w = clamp(w, Math.min(0.03, maxW), maxW);
    return {
      ...m,
      w,
      x: clamp(x, 0, 1 - w),
      y: clamp(y, 0, 1 - (w * size.width) / size.height / m.ratio),
    };
  }
  function add(sig, x = 0.5, y = 0.5) {
    if (!sig || !size) return;
    const w = Math.min(0.28, (0.25 * sig.ratio * size.height) / size.width);
    const m = bounded(
      { ...sig, id: ++latest.current, page },
      x - w / 2,
      y - (w * size.width) / size.height / sig.ratio / 2,
      w,
    );
    setMarks((prev) => [...prev, m]);
    select(m.id);
    setPlacing(false);
  }
  function startPlace() {
    if (!signature) {
      editSignature(() => setPlacing(true));
      return;
    }
    setPlacing(!placing);
  }
  function pos(e) {
    const r = sheet.current.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }
  async function finish() {
    if (!marks.length && doc.signed) {
      downloadPDF(doc.signed, doc.name);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { signedPDF } = await import("./pdf");
      const result = await signedPDF(source, marks, pdf);
      downloadPDF(result, doc.name);
      await draftQueue.current.catch(() => {});
      await onExport(result, draftHandle.current);
      if (!accountWorkspace) await writeGuestStorage(guest, (storage) => clearDraft(doc, storage));
      onClose();
    } catch (e) {
      setError(
        e.message || "The signed PDF could not be generated. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="editor">
      <button
        disabled={busy}
        className="text-button back"
        onClick={() => (marks.length ? setLeave(true) : onClose())}
      >
        <ArrowLeft size={16} /> Workspace
      </button>
      <div className="editor-head">
        <div>
          <h1>{doc.name}</h1>
          <p>
            {pdf.numPages} {pdf.numPages === 1 ? "page" : "pages"} · PDF
            document
          </p>
        </div>
        <button
          className="primary"
          disabled={(!marks.length && !doc.signed) || busy}
          onClick={finish}
        >
          {busy ? <LoaderCircle className="spin" /> : <Download size={17} />}
          Download signed PDF
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <p className="tool-help" role="status">
        {draftError || (doc.temporary
          ? "This PDF is only available in this tab. Download it before leaving or reloading."
          : marks.length
            ? "Draft saved on this device. Reopen this document to continue after a reload."
            : "Signature placements are saved as a draft while you work.")}
      </p>
      <div className="editor-grid" inert={busy}>
        <aside className="card editor-tools">
          <h2>
            <PenTool size={18} />
            Signature
          </h2>
          <div className="tool-signature">
            {signature ? (
              <img src={signature.image} alt="Saved signature" />
            ) : (
              <span className="hand">Your signature</span>
            )}
          </div>
          <button
            className="primary full"
            disabled={!size || busy}
            onClick={startPlace}
          >
            <Plus size={16} />
            {placing
              ? "Cancel placement"
              : signature
                ? "Place signature"
                : "Create signature"}
          </button>
          <p className="tool-help">
            {placing
              ? "Tap the page where you want to sign."
              : "Place your signature, then drag it into position."}
          </p>
          {current && size && (
            <div className="mark-tools">
              <label htmlFor="scale">Signature size</label>
              <input
                id="scale"
                type="range"
                min=".03"
                max=".85"
                step=".005"
                value={current.w}
                onChange={(e) => {
                  const w = Number(e.target.value);
                  setMarks(
                    marks.map((m) =>
                      m.id === current.id ? bounded(m, m.x, m.y, w) : m,
                    ),
                  );
                }}
              />
              <button
                className="text-button"
                onClick={() => {
                  setMarks(marks.filter((m) => m.id !== current.id));
                  select(null);
                }}
              >
                <Trash2 size={14} />
                Remove placement
              </button>
            </div>
          )}
        </aside>
        <section className="viewer">
          <div className="viewer-bar">
            <span>
              <FileText size={15} />
              Document preview
            </span>
            <div className="pager">
              <button
                className="icon-button"
                disabled={page === 1}
                aria-label="Previous page"
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={17} />
              </button>
              {page} / {pdf.numPages}
              <button
                className="icon-button"
                disabled={page === pdf.numPages}
                aria-label="Next page"
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={17} />
              </button>
            </div>
          </div>
          {placing && (
            <div className="place-hint">
              <MousePointer2 size={15} />
              Click the page to place your signature.
              <button className="text-button" onClick={() => add(signature)}>
                Place in center
              </button>
            </div>
          )}
          <div className="paper-area">
            <div
              ref={sheet}
              className={"pdf-sheet " + (placing ? "placing" : "")}
              style={{
                aspectRatio: size ? size.width / size.height : undefined,
              }}
              onClick={(e) => {
                if (placing && size) add(signature, ...pos(e));
                else if (e.target === canvas.current) select(null);
              }}
            >
              <canvas
                ref={canvas}
                style={{ display: size ? "block" : "none" }}
                aria-label={"PDF page " + page}
              />
              {!size && (
                <div className="page-loading">
                  {error ? "Preview unavailable" : "Loading page…"}
                </div>
              )}
              {size &&
                marks
                  .filter((m) => m.page === page)
                  .map((m) => (
                    <button
                      key={m.id}
                      aria-label="Move signature"
                      className={"mark " + (m.id === selected ? "active" : "")}
                      style={{
                        left: m.x * 100 + "%",
                        top: m.y * 100 + "%",
                        width: m.w * 100 + "%",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        select(m.id);
                      }}
                      onKeyDown={(e) => {
                        const moves = {
                          ArrowLeft: [-0.005, 0],
                          ArrowRight: [0.005, 0],
                          ArrowUp: [0, -0.005],
                          ArrowDown: [0, 0.005],
                        };
                        if (moves[e.key]) {
                          e.preventDefault();
                          const [dx, dy] = moves[e.key];
                          setMarks((prev) =>
                            prev.map((item) =>
                              item.id === m.id
                                ? bounded(
                                    item,
                                    item.x + dx,
                                    item.y + dy,
                                    item.w,
                                  )
                                : item,
                            ),
                          );
                        }
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        select(m.id);
                        setPlacing(false);
                        const [x, y] = pos(e);
                        drag.current = { id: m.id, dx: x - m.x, dy: y - m.y };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        const d = drag.current;
                        if (d?.id !== m.id) return;
                        d.moved = true;
                        const [x, y] = pos(e);
                        setMarks((prev) =>
                          prev.map((item) =>
                            item.id === d.id
                              ? bounded(item, x - d.dx, y - d.dy, item.w)
                              : item,
                          ),
                          false,
                        );
                      }}
                      onPointerUp={finishDrag}
                      onPointerCancel={finishDrag}
                      onLostPointerCapture={finishDrag}
                    >
                      <img draggable="false" src={m.image} alt="" />
                    </button>
                  ))}
            </div>
          </div>
        </section>
      </div>
      {leave && (
        <Dialog title="Leave this document?" close={() => setLeave(false)}>
          <p className="modal-copy">
            Keep your draft to continue later, or discard its signature placements.
          </p>
          <div className="modal-actions">
            <button className="secondary" onClick={discard}>
              Discard placements
            </button>
            <button className="secondary" disabled={!!draftError || doc.temporary} onClick={keepDraft}>
              Keep draft
            </button>
            <button className="primary" onClick={() => setLeave(false)}>
              Keep signing
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
