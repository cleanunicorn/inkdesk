# Inkdesk

A local PDF signing workspace for desktop and mobile browsers.

With Node.js, npm, and Make installed, run `make install` to install dependencies
from the lockfile, then `make dev` to start the development server with hot reload.
Run `make test` for all tests. `make build` produces the app in `dist/`;
`make preview` previews that production build on all network interfaces.
Run `make` or `make help` to list the available commands. The underlying npm
scripts remain available directly.

## Mobile installation

Serve `dist/` at the root of an HTTPS origin. The Install app button opens the
browser's installation prompt when available, otherwise shows instructions for
Safari on iPhone/iPad and Chrome on Android. Installation is optional: all signing
features also work in the browser. Localhost supports development testing, but a
plain HTTP LAN address cannot provide installation or service-worker support.

The production build generates a versioned service worker that caches the app,
fonts, lazy-loaded signing code, and PDF rendering resources. After the initial
cache finishes, the workspace can reopen and sign local PDFs offline. Development
mode does not register a service worker. New releases activate after existing app
tabs/windows close, avoiding a reload during signing.

Documents and signatures remain in local browser storage. They do not sync between
devices or browser profiles; an installed app may have separate storage depending
on the platform. Keep exported PDF copies: clearing site data removes local work.

Signature placements are saved locally as you edit. After a reload or app restart,
reopen the document from the workspace to restore its draft. Drafts are tied to the
PDF revision and cleared after export or explicit discard. If storage is unavailable
or the source PDF is temporary, the editor warns you to download before leaving.

Browser verification covers 320px and 390px layouts and offline PDF opening,
signature creation, and placement. Physical iOS/Android installation and their
native file-saving interfaces still require device testing.
