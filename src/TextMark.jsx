import React, { useState } from "react";
import { Check } from "lucide-react";
import { Dialog } from "./Signature";
import { INKS, textInk } from "./ink";

export default function TextMark({ close, onSave, existing, color = INKS.Black }) {
  const [text, setText] = useState(existing?.text || "");
  const [handwritten, setHandwritten] = useState(existing?.handwritten ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setSaving(true);
    try {
      onSave({ ...await textInk(text, INKS.Black, handwritten), kind: "text", text: text.trim(), color, handwritten });
    } catch {
      setError("This text could not be created. Please try again.");
    } finally {
      setSaving(false);
    }
  }
  return <Dialog title={existing ? "Edit text" : "Add date, location or text"} close={close}>
    <p className="modal-copy">Add a separate piece of writing, then move and resize it on the page.</p>
    <label className="field-label" htmlFor="mark-text">Text to add</label>
    <textarea id="mark-text" rows={3} maxLength={200} autoFocus value={text}
      placeholder={"25 November 2026\nBucharest"} onChange={(e) => setText(e.target.value)} />
    <button className="text-button today-button" onClick={() => setText(new Date().toLocaleDateString(undefined,
      { day: "numeric", month: "long", year: "numeric" }))}>Use today’s date</button>
    <div className="segmented" role="group" aria-label="Text style">
      <button aria-pressed={handwritten} className={handwritten ? "selected" : ""}
        onClick={() => setHandwritten(true)}>Handwritten</button>
      <button aria-pressed={!handwritten} className={!handwritten ? "selected" : ""}
        onClick={() => setHandwritten(false)}>Printed</button>
    </div>
    <div className={"type-preview text-mark-preview " + (handwritten ? "" : "printed")} style={{ color }}>
      {text || "Your date or location"}
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    <div className="modal-actions">
      <button className="secondary" onClick={close}>Cancel</button>
      <button className="primary" disabled={saving || !text.trim()} onClick={save}>
        <Check size={16} />{existing ? "Save text" : "Place text"}
      </button>
    </div>
  </Dialog>;
}
