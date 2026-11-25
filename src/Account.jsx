import React, { useEffect, useRef, useState } from "react";
import { Dialog } from "./Signature";
import {
  AccountWorkspace, accountKey, api, guestKey, importGuest, localValue,
} from "./account";
import { createDocumentId } from "./document-id";
import { getAccountState } from "./db";

const pendingClaimKey = "inkdesk-pending-claim";

function pendingClaim() {
  try {
    return JSON.parse(localValue(pendingClaimKey));
  } catch {
    return null;
  }
}

function cachedAccount() {
  try {
    return JSON.parse(localValue(accountKey));
  } catch {
    return null;
  }
}

function rememberAccount(account) {
  try {
    if (account) localStorage.setItem(accountKey, JSON.stringify(account));
    else localStorage.removeItem(accountKey);
  } catch {
    // The session cookie still works when local storage is unavailable.
  }
}

export function AccountRoot({ Workspace }) {
  const [guest, setGuest] = useState(() => localValue(guestKey));
  const [workspace, setWorkspace] = useState(null);
  const [ready, setReady] = useState(false);
  const [restoreError, setRestoreError] = useState("");

  async function openAccount(account) {
    if (!account) return null;
    const next = new AccountWorkspace(account);
    await next.load();
    const claim = pendingClaim();
    if (claim?.username === account.username) {
      await importGuest(next, claim.guest, claim.nextGuest, () => {
        localStorage.setItem(guestKey, claim.nextGuest);
      });
      localStorage.removeItem(pendingClaimKey);
    }
    return next;
  }

  useEffect(() => {
    let active = true;
    async function restore() {
      let account;
      try {
        ({ account } = await api("session", { timeout: 3000 }));
      } catch {
        account = cachedAccount();
      }
      try {
        const open = () => openAccount(account);
        const next = await (navigator.locks?.request("inkdesk-authenticate", open) ?? open());
        if (active) {
          rememberAccount(account);
          setGuest(localValue(guestKey));
          setWorkspace(next);
        }
      } catch (error) {
        if (active) {
          setRestoreError(error.code === "storage-blocked" ? error.message :
            "Inkdesk couldn’t open your saved account. Reload to retry.");
        }
      } finally {
        if (active) setReady(true);
      }
    }
    restore();
    const refresh = (event) => {
      if (event.key === accountKey || event.key === guestKey) window.location.reload();
    };
    window.addEventListener("storage", refresh);
    return () => {
      active = false;
      window.removeEventListener("storage", refresh);
    };
  }, []);

  async function authenticate(mode, username, password) {
    const run = async () => {
      const claiming = mode === "claim";
      if (claiming) {
        if (localValue(guestKey) !== guest) throw new Error("Your workspace changed in another tab. Reload and try again.");
        await getAccountState("claim-preflight");
        localStorage.setItem(pendingClaimKey, JSON.stringify({
          guest, nextGuest: `guest:${createDocumentId()}`, username: username.trim().toLowerCase(),
        }));
      }
      let account;
      try {
        ({ account } = await api(mode, { method: "POST", body: { username, password } }));
      } catch (error) {
        if (claiming && error.status >= 400 && error.status < 500) localStorage.removeItem(pendingClaimKey);
        throw error;
      }
      rememberAccount(account);
      const next = await openAccount(account);
      setGuest(localValue(guestKey));
      setWorkspace(next);
    };
    await (navigator.locks?.request("inkdesk-authenticate", run) ?? run());
  }

  async function signOut() {
    try {
      await workspace.sync();
    } catch {
      // Unsynced changes remain in this account's cache for its next sign-in.
    }
    await api("sign-out", { method: "POST", account: workspace.account.id, body: {} });
    rememberAccount(null);
    setWorkspace(null);
  }

  if (!ready) return <main className="workspace account-loading" role="status">Opening Inkdesk…</main>;
  if (restoreError) {
    return (
      <main className="workspace account-loading">
        <p role="alert">{restoreError}</p>
        <button className="secondary" onClick={() => window.location.reload()}>Reload Inkdesk</button>
      </main>
    );
  }
  return (
    <Workspace
      key={workspace?.account.id ?? guest ?? "guest"}
      accountWorkspace={workspace}
      guest={guest}
      authenticate={authenticate}
      signOut={signOut}
    />
  );
}

export function useAccountSync(workspace, onChange) {
  const [status, setStatus] = useState(workspace ? "Syncing…" : "");
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    if (!workspace) return;
    let timer;
    let active = true;
    async function sync(showProgress = false) {
      if (showProgress) setStatus("Syncing…");
      try {
        await workspace.sync();
        if (active) setStatus("Synced");
      } catch (error) {
        if (active) setStatus(error.status === 401 ? "Sign in to sync" :
          error.status === 413 ? "Some items over sync limit" : "Sync paused");
      }
    }
    function schedule() {
      setStatus("Syncing…");
      clearTimeout(timer);
      timer = setTimeout(() => sync(), 500);
    }
    const retry = () => sync(true);
    workspace.onWrite = schedule;
    workspace.onChange = () => change.current();
    workspace.retry = retry;
    retry();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") sync();
    }, 15_000);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      delete workspace.onWrite;
      delete workspace.onChange;
      delete workspace.retry;
    };
  }, [workspace]);
  return status;
}

export default function AccountDialog({ workspace, status, authenticate, signOut, close }) {
  const [mode, setMode] = useState(workspace && status === "Sign in to sync" ? "sign-in" :
    workspace ? "account" : "claim");
  const [username, setUsername] = useState(workspace?.account.username ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (mode === "account") await signOut();
      else await authenticate(mode, username, data.get("password"));
      close();
    } catch (failure) {
      setError(failure.status || failure.code === "storage-blocked" || mode === "account" ? failure.message :
        "Account access is unavailable. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const claiming = mode === "claim";
  return (
    <Dialog title={claiming ? "Claim this workspace" : mode === "sign-in" ? "Sign in" : "Your account"}
      close={() => { if (!busy) close(); }}>
      <form className="account-form" onSubmit={submit}>
        {mode === "account" ? (
          <>
            <p>Signed in as <strong>{workspace.account.username}</strong></p>
            <p role="status">{status}</p>
            {status === "Some items over sync limit" && <small>Each item has a 64 MB encoded limit. Oversized items stay on this device. You can remove them from Documents.</small>}
            {status !== "Synced" && <small>Pending changes stay on this device until they sync.</small>}
            {status !== "Synced" && status !== "Syncing…" && (
              <button type="button" className="secondary" onClick={() => workspace.retry?.()}>Retry sync</button>
            )}
          </>
        ) : (
          <>
            <p>{claiming
              ? "Create an account to upload this workspace’s documents, signature, and drafts and access them on your other devices."
              : "Use your Inkdesk username and password to open your workspace."}</p>
            <label>
              Username
              <input name="username" value={username} onChange={(event) => setUsername(event.target.value)}
                autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} />
            </label>
            <label>
              Password
              <input key={mode} name="password" type="password" required minLength={12} maxLength={128}
                autoComplete={claiming ? "new-password" : "current-password"} />
            </label>
            {claiming && <small>Use at least 12 characters. Save your password somewhere safe. Inkdesk has no password reset.</small>}
          </>
        )}
        {error && <p className="account-error" role="alert">{error}</p>}
        <button className="primary full" disabled={busy}>
          {busy ? "Please wait…" : claiming ? "Claim workspace" : mode === "sign-in" ? "Sign in" : "Sign out"}
        </button>
        {!workspace && (
          <button className="text-button" type="button" disabled={busy} onClick={() => {
            setMode(claiming ? "sign-in" : "claim");
            setError("");
          }}>
            {claiming ? "Already have an account? Sign in" : "Claim this workspace instead"}
          </button>
        )}
      </form>
    </Dialog>
  );
}
