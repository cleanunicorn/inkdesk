import React, { useEffect, useRef, useState } from "react";
import { X, PenLine, Type, RotateCcw, Check, Signature } from "lucide-react";

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
function crop(canvas) {
  const ctx = canvas.getContext("2d"),
    { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        left = Math.min(x, left);
        right = Math.max(x, right);
        top = Math.min(y, top);
        bottom = Math.max(y, bottom);
      }
    }
  if (left > right) throw new Error("Add a signature first.");
  const out = document.createElement("canvas");
  out.width = right - left + 9;
  out.height = bottom - top + 9;
  out
    .getContext("2d")
    .drawImage(
      canvas,
      left,
      top,
      right - left + 1,
      bottom - top + 1,
      4,
      4,
      right - left + 1,
      bottom - top + 1,
    );
  return { image: out.toDataURL("image/png"), ratio: out.width / out.height };
}
export default function SignatureModal({ close, onSave, existing, account }) {
  const [mode, setMode] = useState("draw"),
    [name, setName] = useState(""),
    [drawn, setDrawn] = useState(false),
    [error, setError] = useState("");
  const canvas = useRef(null),
    active = useRef(false);
  function draw(e, start = false) {
    if (!start && !active.current) return;
    const c = canvas.current,
      rect = c.getBoundingClientRect(),
      ctx = c.getContext("2d");
    const x = ((e.clientX - rect.left) * c.width) / rect.width,
      y = ((e.clientY - rect.top) * c.height) / rect.height;
    ctx.strokeStyle = ctx.fillStyle = "#29243a";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (start) {
      active.current = true;
      c.setPointerCapture(e.pointerId);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, y);
    }
    setDrawn(true);
  }
  async function save() {
    try {
      let c = canvas.current;
      if (mode === "type") {
        await document.fonts.load("100px Allura");
        c = document.createElement("canvas");
        let ctx = c.getContext("2d");
        ctx.font = "100px Allura";
        c.width = Math.ceil(ctx.measureText(name.trim()).width) + 120;
        c.height = 230;
        ctx = c.getContext("2d");
        ctx.font = "100px Allura";
        ctx.fillStyle = "#29243a";
        ctx.fillText(name.trim(), 60, 145);
      }
      await onSave(crop(c));
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Dialog
      title={existing ? "Replace signature" : "Create your signature"}
      close={close}
    >
      <p className="modal-copy">
        {account ? "Draw or type your signature to save it to your account." : "Draw or type your signature to save it on this device."}
      </p>
      <div className="segmented">
        {[
          ["draw", PenLine, "Draw"],
          ["type", Type, "Type"],
        ].map(([key, Icon, label]) => (
          <button
            key={key}
            aria-pressed={mode === key}
            className={mode === key ? "selected" : ""}
            onClick={() => setMode(key)}
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
            onPointerUp={() => (active.current = false)}
            onPointerCancel={() => (active.current = false)}
          />
        </div>
        <div className="pad-caption">
          <span>Sign with your mouse, finger, or stylus.</span>
          <button
            className="text-button"
            onClick={() => {
              canvas.current.getContext("2d").clearRect(0, 0, 1000, 360);
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
          <div className="type-preview">{name || <Signature size={36} />}</div>
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
          disabled={mode === "draw" ? !drawn : !name.trim()}
          onClick={save}
        >
          <Check size={16} />
          Save signature
        </button>
      </div>
    </Dialog>
  );
}
