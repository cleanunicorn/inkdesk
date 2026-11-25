import React, { useEffect, useState } from "react";
import { Dialog } from "./Signature";

export default function InstallApp() {
  const [prompt, setPrompt] = useState(null);
  const [help, setHelp] = useState(false);
  const [installed, setInstalled] = useState(() =>
    matchMedia("(display-mode: standalone)").matches || navigator.standalone === true,
  );
  useEffect(() => {
    const capture = (event) => { event.preventDefault(); setPrompt(event); };
    const done = () => { setInstalled(true); setPrompt(null); setHelp(false); };
    window.addEventListener("beforeinstallprompt", capture);
    window.addEventListener("appinstalled", done);
    return () => {
      window.removeEventListener("beforeinstallprompt", capture);
      window.removeEventListener("appinstalled", done);
    };
  }, []);
  async function install() {
    if (!prompt) { setHelp(true); return; }
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      setHelp(true);
    } finally {
      setPrompt(null);
    }
  }
  if (installed) return null;
  return <>
    <button className="secondary install-button" onClick={install}>Install app</button>
    {help && <Dialog title="Install Inkdesk" close={() => setHelp(false)}>
      <p className="modal-copy">Keep Inkdesk on your home screen for quick access.</p>
      <ol className="guide">
        <li><strong>iPhone or iPad:</strong> Open this site in Safari, open Share, then choose Add to Home Screen. Enable Open as Web App if offered.</li>
        <li><strong>Android:</strong> Open this site in Chrome, then choose Install app or Add to Home screen from the browser menu.</li>
      </ol>
      <p className="modal-copy">You can also keep using Inkdesk in your browser. Documents stay in the browser or app where you saved them; they do not sync between devices. Keep downloaded copies of important files.</p>
      <button className="primary full" onClick={() => setHelp(false)}>Got it</button>
    </Dialog>}
  </>;
}
