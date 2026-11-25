# Inkdesk

A PDF signing workspace for desktop and mobile browsers, with optional account sync.

With Node.js 24+, npm, and Make installed, run `make install` to install dependencies
from the lockfile, then `make dev` to start the development server with hot reload.
Run `make test` for all tests. `make build` produces the app in `dist/`;
`make preview` previews that production build on all network interfaces.
Run `make` or `make help` to list the available commands. The underlying npm
scripts remain available directly.

## Mobile installation

Open Inkdesk at the root of an HTTPS origin. The Install app button opens the
browser's installation prompt when available, otherwise shows instructions for
Safari on iPhone/iPad and Chrome on Android. Installation is optional: all signing
features also work in the browser. Localhost supports development testing, but a
plain HTTP LAN address cannot provide installation or service-worker support.

The production build generates a versioned service worker that caches the app,
fonts, lazy-loaded signing code, and PDF rendering resources. After the initial
cache finishes, the workspace can reopen and sign local PDFs offline. Development
mode does not register a service worker. New releases activate after existing app
tabs/windows close, avoiding a reload during signing.

An unclaimed workspace keeps its documents, signature, and drafts in the browser.
Select **Claim workspace** to create an account and sync existing work. On another
device, open the same Inkdesk URL and select **Claim workspace** → **Sign in**.
Use your username and password. Inkdesk has no email delivery or password reset.

Account changes are cached in each signed-in browser and sync automatically when
online. Wait for **Synced** in the account dialog before switching devices. The
64 MB limit applies to each encoded item, including the original and signed
copies stored for a single PDF. An oversized item stays in the browser while
other items sync. Remove it from **Documents** if you no longer need it.
Signing into an existing account keeps that browser's guest workspace separate.

Claiming includes guest work saved before the import starts. If another tab
finishes saving a PDF after that point, it stays in the new guest workspace.
Close older Inkdesk tabs or app windows and reload if a storage upgrade is
blocked.

Signature placements are saved as you edit. After a reload or app restart,
reopen the document from the workspace to restore its draft. Drafts are tied to the
PDF revision and cleared after export or explicit discard. If storage is unavailable
or the source PDF is temporary, the editor warns you to download before leaving.

## Hosting with accounts

Run `npm run build` and `npm start` on a host with persistent storage. The
Node.js server serves the app and its account API on the same origin. Put it
behind an HTTPS reverse proxy and preserve the original public URL if upgrading
a static deployment, so existing browsers can still read and claim local work.

The server listens on `127.0.0.1:4173` by default. Set `HOST` and `PORT` to
override it and `INKDESK_DATABASE` to select the SQLite file (default
`data/inkdesk.sqlite`). Keep this file outside public asset directories and use
SQLite's backup tools to back up password hashes and synced workspaces.
Development and preview commands include the account API for local testing.
Static-only hosting supports guest workspaces.

Browser verification covers 320px and 390px layouts and offline PDF opening,
signature creation, and placement. Physical iOS/Android installation and their
native file-saving interfaces still require device testing.
