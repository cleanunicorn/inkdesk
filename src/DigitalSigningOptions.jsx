import React from "react";
import { ShieldCheck } from "lucide-react";

export default function DigitalSigningOptions({ value, onChange }) {
  return <section className="digital-options" aria-label="Digital signature">
    <label className="digital-toggle">
      <input type="checkbox" checked={value.enabled} onChange={(e) => onChange({
        enabled: e.target.checked, file: null, password: "",
      })} />
      <span><ShieldCheck size={16} />Sign with a certificate</span>
    </label>
    <p className="tool-help">Optional digital signature, verifiable in a PDF reader.</p>
    {value.enabled && <div className="certificate-fields">
      <label className="field-label" htmlFor="signing-certificate">Signing certificate (.p12 / .pfx)</label>
      <input id="signing-certificate" type="file" accept=".p12,.pfx,application/x-pkcs12"
        onChange={(e) => onChange({ ...value, file: e.target.files?.[0] || null })} />
      <label className="field-label" htmlFor="certificate-password">Certificate password</label>
      <input id="certificate-password" type="password" autoComplete="off" value={value.password}
        onChange={(e) => onChange({ ...value, password: e.target.value })} />
      <p className="tool-help">Use an RSA signing certificate. The file and password stay in this tab and are never saved.</p>
      <p className="tool-help">Trust depends on the certificate issuer. This adds no trusted timestamp or revocation check.</p>
    </div>}
  </section>;
}
