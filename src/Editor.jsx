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
  Type,
} from "lucide-react";
import { downloadPDF } from "./download";
import { Dialog, InkColors } from "./Signature";
import { readDraftState, writeDraftState, clearDraft } from "./drafts";
import { guestStorage, writeGuestStorage } from "./account";
import TextMark from "./TextMark";
import InkImage from "./InkImage";
import DigitalSigningOptions from "./DigitalSigningOptions";
import { INKS, colorDocument } from "./ink";
import { signaturePlacement } from "./signature-placement";
import { signatureSamples } from "./signature-samples";
import { boundMark, resizeMark } from "./placement";
const corners = { nw: "top left", ne: "top right", sw: "bottom left", se: "bottom right" };
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
      const state = accountWorkspace
        ? accountWorkspace.readDraftState(doc, draftHandle.current)
        : readDraftState(doc, guestStorage(guest));
      return { ...state, error: "" };
    } catch {
      return { marks: [], color: INKS.Blue, error: "Your saved draft could not be read. New edits may replace it. Download your signed PDF before leaving." };
    }
  });
  const [ink, setInk] = useState(draft.color);
  const inkRef = useRef(draft.color);
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const [digital, setDigital] = useState({ enabled: false, file: null, password: "" });
  const [draftError, setDraftError] = useState(draft.error);
  const [page, setPage] = useState(draft.marks[0]?.page ?? 1),
    [size, setSize] = useState(null),
    [marks, updateMarks] = useState(draft.marks),
    [selected, select] = useState(null),
    [placing, setPlacing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [leave, setLeave] = useState(false);
  const [textDialog, setTextDialog] = useState(null);
  const [pendingText, setPendingText] = useState(null);
  const canvas = useRef(),
    sheet = useRef(),
    drag = useRef(null),
    latest = useRef(Math.max(0, ...draft.marks.map((mark) => mark.id)));
  const marksRef = useRef(draft.marks);
  function persistDraft(state) {
    const pending = draftQueue.current.catch(() => {}).then(() => accountWorkspace
      ? accountWorkspace.writeDraftState(doc, state, draftHandle.current)
      : writeGuestStorage(guest, (storage) => {
        if (state) writeDraftState(doc, state, storage);
        else clearDraft(doc, storage);
      }));
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
    if (persist) persistDraft({ marks: next, color: inkRef.current });
  }
  function finishDrag(event) {
    if (!drag.current || (event && drag.current.pointerId !== event.pointerId)) return;
    const { moved } = drag.current;
    drag.current = null;
    if (moved) persistDraft({ marks: marksRef.current, color: inkRef.current });
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
  function changeInk(color) {
    inkRef.current = color;
    setInk(color);
    persistDraft({ marks: marksRef.current, color });
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
      await persistDraft(null);
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
    return boundMark(m, x, y, w, size);
  }
  async function add(sig, x = 0.5, y = 0.5) {
    if (!sig || !size || addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    setError("");
    try {
      const previous = marksRef.current.filter((m) => m.kind !== "text").at(-1)?.sampleIndex ?? -1;
      const appearance = sig.kind === "text" ? sig : await signaturePlacement(sig, previous);
      const w = Math.min(0.28, (0.25 * appearance.ratio * size.height) / size.width);
      const m = bounded(
        { ...appearance, id: ++latest.current, page },
        x - w / 2, y - (w * size.width) / size.height / appearance.ratio / 2, w,
      );
      setMarks((prev) => [...prev, m]);
      select(m.id);
      setPlacing(false);
      setPendingText(null);
    } catch (error) {
      setError(error.message || "The signature could not be placed. Please try again.");
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  }
  function startPlace() {
    setPendingText(null);
    if (!signature) {
      editSignature(() => setPlacing("signature"));
      return;
    }
    setPlacing(placing === "signature" ? false : "signature");
  }
  function pos(e) {
    const r = sheet.current.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }
  async function finish() {
    if (!digital.enabled && !marks.length && doc.signed) {
      downloadPDF(doc.signed, doc.name);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { signedPDF } = await import("./pdf");
      let result = marks.length ? await signedPDF(source, await colorDocument(marks, ink), pdf) : source;
      if (digital.enabled) {
        if (!digital.file) throw new Error("Choose your signing certificate first.");
        const { signWithCertificate } = await import("./digital-signing-client");
        result = await signWithCertificate(result, digital.file, digital.password);
        setDigital({ enabled: false, file: null, password: "" });
      }
      downloadPDF(result, doc.name);
      await draftQueue.current.catch(() => {});
      await onExport(result, { inkColor: ink }, draftHandle.current);
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
        disabled={busy || adding}
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
          disabled={busy || adding || (digital.enabled ? !digital.file : (!marks.length && !doc.signed))}
          onClick={finish}
        >
          {busy ? <LoaderCircle className="spin" /> : <Download size={17} />}
          {busy ? "Preparing PDF…" : digital.enabled ? "Digitally sign PDF" : "Download signed PDF"}
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
            : "Your signatures and text are saved as a draft while you work.")}
      </p>
      <div className="editor-grid" inert={busy || adding}>
        <aside className="card editor-tools">
          <div className="document-ink">
            <h2>Document ink</h2>
            <InkColors color={ink} onChange={changeInk} />
            <p className="tool-help">For all signatures and text added here.</p>
          </div>
          <h2>
            <PenTool size={18} />
            Signature
          </h2>
          <div className="tool-signature">
            {signature ? (
              <InkImage image={signature.image} color={ink} alt="Saved signature" />
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
            {placing === "signature"
              ? "Cancel placement"
              : signature
                ? "Place signature"
                : "Create signature"}
          </button>
          <button className="secondary full add-text" disabled={!size || busy}
            onClick={() => { setPlacing(false); setPendingText(null); setTextDialog({}); }}>
            <Type size={16} />Add date / location
          </button>
          {signature && <button className="text-button edit-ink" onClick={() => editSignature()}>
            <PenTool size={14} />Manage samples ({signatureSamples(signature).length})
          </button>}
          {signature && <p className="tool-help">Natural variation is added each time you place a signature.</p>}
          <p className="tool-help">
            {placing
              ? "Tap the page to place your writing."
              : "Drag to move. Drag any corner to resize."}
          </p>
          {current && size && (
            <div className="mark-tools">
              <label htmlFor="scale">{current.kind === "text" ? "Text size" : "Signature size"}</label>
              <input
                id="scale"
                type="range"
                min={Math.min(0.03, 0.9 * current.ratio * size.height / size.width)}
                max={Math.min(0.9, 0.9 * current.ratio * size.height / size.width)}
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
              {current.kind === "text" && <button className="text-button" onClick={() => setTextDialog(current)}>
                <Type size={14} />Edit text
              </button>}
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
          <DigitalSigningOptions value={digital} onChange={setDigital} />
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
              {placing === "text" ? "Click the page to place your text." : "Click the page to place your signature."}
              <button className="text-button" onClick={() => add(placing === "text" ? pendingText : signature)}>
                Place in center
              </button>
              <button className="text-button" onClick={() => { setPlacing(false); setPendingText(null); }}>
                Cancel
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
                if (placing && size) add(placing === "text" ? pendingText : signature, ...pos(e));
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
                    <div
                      key={m.id}
                      role="group"
                      aria-label={m.kind === "text" ? "Text placement" : "Signature placement"}
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
                        const corner = e.target.dataset.corner;
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
                                ? corner ? resizeMark(item, corner, dx, dy, size) : bounded(
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
                        if (e.button !== 0 || drag.current) return;
                        e.stopPropagation();
                        select(m.id);
                        setPlacing(false);
                        const [x, y] = pos(e);
                        drag.current = { id: m.id, pointerId: e.pointerId, corner: e.target.dataset.corner,
                          original: m, x, y, dx: x - m.x, dy: y - m.y };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        const d = drag.current;
                        if (d?.id !== m.id || d.pointerId !== e.pointerId) return;
                        d.moved = true;
                        const [x, y] = pos(e);
                        setMarks((prev) =>
                          prev.map((item) =>
                            item.id === d.id
                              ? d.corner ? resizeMark(d.original, d.corner, x - d.x, y - d.y, size)
                                : bounded(item, x - d.dx, y - d.dy, item.w)
                              : item,
                          ),
                          false,
                        );
                      }}
                      onPointerUp={finishDrag}
                      onPointerCancel={finishDrag}
                      onLostPointerCapture={finishDrag}
                    >
                      <button className="mark-move" aria-label={m.kind === "text" ? "Move text" : "Move signature"}>
                        <InkImage image={m.image} color={ink} />
                      </button>
                      {m.id === selected && Object.entries(corners).map(([corner, label]) => (
                        <button key={corner} className={"resize-handle " + corner} data-corner={corner}
                          aria-label={"Resize " + (m.kind === "text" ? "text" : "signature") + " from " + label}
                          title="Drag to resize, or use arrow keys" />
                      ))}
                    </div>
                  ))}
            </div>
          </div>
        </section>
      </div>
      {textDialog && <TextMark close={() => setTextDialog(null)} existing={textDialog.id ? textDialog : null}
        color={ink} onSave={(text) => {
          if (textDialog.id) {
            setMarks((prev) => prev.map((m) => m.id === textDialog.id
              ? bounded({ ...m, ...text }, m.x, m.y, m.w) : m));
          } else {
            setPendingText(text);
            setPlacing("text");
          }
          setTextDialog(null);
        }} />}
      {leave && (
        <Dialog title="Leave this document?" close={() => setLeave(false)}>
          <p className="modal-copy">
            Keep your draft to continue later, or discard its signatures and text.
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
