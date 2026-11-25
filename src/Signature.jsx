import React, { useEffect, useRef, useState } from "react";
import { X, PenLine, Type, RotateCcw, Check, Signature, Undo2, Trash2 } from "lucide-react";
import { INKS, crop, textInk } from "./ink";
import { penWidth, renderInk } from "./pen";
import { signatureSamples } from "./signature-samples";

export function Dialog({ title, children, close }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-inner">
        <header className="modal-head">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function InkColors({ color, onChange }) {
  return <div className="ink-colors" role="group" aria-label="Ink color">
    <span>Ink</span>
    {Object.entries(INKS).map(([label, value]) => (
      <button key={label} type="button" aria-pressed={color === value}
        className={color === value ? "selected" : ""} onClick={() => onChange(value)}>
        <span className="ink-swatch" style={{ background: value }} />{label}
      </button>
    ))}
  </div>;
}
export default function SignatureModal({ close, onSave, existing }) {
  const [mode, setMode] = useState("draw"),
    [name, setName] = useState(""),
    [drawn, setDrawn] = useState(false),
    [samples, setSamples] = useState(() => signatureSamples(existing)),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const color = INKS.Black;
  const canvas = useRef(null), active = useRef(null), strokes = useRef([]), frame = useRef(null);
  function repaint() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      renderInk(canvas.current, strokes.current, color);
    });
  }
  useEffect(() => {
    renderInk(canvas.current, strokes.current, color);
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [color]);
  function draw(e, start = false) {
    if (start) {
      if (active.current !== null || e.button !== 0) return;
      active.current = e.pointerId;
      canvas.current.setPointerCapture(e.pointerId);
      strokes.current.push([]);
    }
    if (active.current !== e.pointerId) return;
    const c = canvas.current, rect = c.getBoundingClientRect();
    const stroke = strokes.current.at(-1);
    const events = e.nativeEvent.getCoalescedEvents?.();
    for (const event of events?.length ? events : [e]) {
      const point = { x: (event.clientX - rect.left) * c.width / rect.width,
        y: (event.clientY - rect.top) * c.height / rect.height,
        time: event.timeStamp, pressure: event.pressure, pointerType: event.pointerType };
      const previous = stroke.at(-1);
      if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) continue;
      const target = penWidth(point, previous);
      point.width = previous ? previous.width * 0.65 + target * 0.35 : target;
      stroke.push(point);
    }
    repaint();
    setDrawn(true);
    setError("");
  }
  function endStroke(e) {
    if (active.current !== e.pointerId) return;
    if (e.type === "pointerup") draw(e);
    active.current = null;
  }
  async function save() {
    setSaving(true);
    try {
      let next = samples;
      if (mode === "draw" ? drawn : name.trim()) {
        if (samples.length >= 5) throw new Error("You can keep up to five samples. Remove one before adding another.");
        renderInk(canvas.current, strokes.current, color);
        const result = mode === "type" ? await textInk(name, color) : {
          ...crop(canvas.current), strokes: strokes.current,
        };
        next = [...samples, result];
      }
      if (!next.length) throw new Error("Add a signature first.");
      onSave({ image: next[0].image, ratio: next[0].ratio, samples: next });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      title={existing ? "Your signature samples" : "Create your signature"}
      close={close}
    >
      <p className="modal-copy">
        Smooth pen strokes and subtle variations are automatic. Add another sample
        for more variety; we’ll choose one each time you sign.
      </p>
      {samples.length > 0 && <div className="signature-samples" aria-label="Saved signature samples">
        {samples.map((sample, index) => <div key={index}>
          <img src={sample.image} alt={"Signature sample " + (index + 1)} />
          <button className="icon-button" aria-label={"Remove sample " + (index + 1)}
            onClick={() => setSamples(samples.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
        </div>)}
      </div>}
      <div className="segmented">
        {[
          ["draw", PenLine, "Draw"],
          ["type", Type, "Type"],
        ].map(([key, Icon, label]) => (
          <button
            key={key}
            aria-pressed={mode === key}
            className={mode === key ? "selected" : ""}
            onClick={() => { active.current = null; setMode(key); }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <div hidden={mode !== "draw"}>
        <div className="draw-pad">
          <canvas
            ref={canvas}
            width="1000"
            height="360"
            aria-label="Draw your signature"
            onPointerDown={(e) => draw(e, true)}
            onPointerMove={(e) => draw(e)}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onLostPointerCapture={endStroke}
          />
        </div>
        <div className="pad-caption">
          <span>Natural pen strokes. Use your mouse, finger, or stylus.</span>
          <button className="text-button" disabled={!drawn} onClick={() => {
            active.current = null;
            strokes.current.pop();
            renderInk(canvas.current, strokes.current, color);
            setDrawn(strokes.current.length > 0);
          }}><Undo2 size={13} />Undo</button>
          <button
            className="text-button"
            onClick={() => {
              active.current = null;
              strokes.current = [];
              renderInk(canvas.current, [], color);
              setDrawn(false);
            }}
          >
            <RotateCcw size={13} />
            Clear
          </button>
        </div>
      </div>
      {mode === "type" && (
        <>
          <label className="field-label" htmlFor="signature-name">
            Your name
          </label>
          <input
            id="signature-name"
            maxLength={64}
            autoFocus
            placeholder="Enter your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="type-preview" style={{ color }}>{name || <Signature size={36} />}</div>
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="secondary" onClick={close}>
          Cancel
        </button>
        <button
          className="primary"
          disabled={saving || (!samples.length && (mode === "draw" ? !drawn : !name.trim()))}
          onClick={save}
        >
          <Check size={16} />
          Save signature
        </button>
      </div>
    </Dialog>
  );
}
