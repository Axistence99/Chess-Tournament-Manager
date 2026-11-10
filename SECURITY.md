# Security Policy

## Supported version

Security fixes are applied to the latest code on the `main` branch and to the current GitHub Pages deployment. Older downloaded builds, cached copies, forks, and locally modified versions are not supported.

## Reporting a vulnerability

Please do not publish exploit details, malicious backup files, personal tournament data, or credentials in a public issue.

1. Prefer GitHub's private **Report a vulnerability** / Security Advisory feature for this repository, if it is enabled.
2. If private reporting is unavailable, open a minimal public issue asking the maintainer for a private contact channel. Do not include reproduction payloads or sensitive data in that issue.
3. Include the affected version or commit, impact, prerequisites, reproducible steps, and a safe proof of concept.

The maintainer should acknowledge a report, assess severity, and coordinate disclosure as availability permits. Please allow a reasonable remediation period before public disclosure.

## Architecture and trust boundaries

Chest-Tournament Manager is a static, browser-only Progressive Web App deployed to GitHub Pages. It has no application backend, API, account system, database, cloud sync, analytics, or AI integration. Tournament and profile data remain on the device unless the organizer explicitly exports a file.

The main untrusted inputs are:

- tournament, player, and team fields entered by an organizer;
- imported CSV player lists;
- imported JSON tournament backups;
- uploaded player images; and
- files opened later in spreadsheet, PDF, image, archive, or chess software.

Only import files from a trusted source. A backup is data, not executable code, but malformed or deliberately hostile files may attempt to exhaust browser resources or inject unsafe content. The application applies type, size, schema, range, identifier, image-source, and relationship checks before accepting a backup.

## Security practices

- User-controlled text is escaped before HTML-template interpolation.
- A restrictive Content Security Policy limits scripts, images, workers, connections, forms, frames, and plugins to the capabilities required by the app.
- The pre-render theme bootstrap is a same-origin external script; inline JavaScript is not permitted by the policy.
- Profile images are limited to JPEG, PNG, and WebP, capped at 10 MB, dimension-checked, decoded, center-cropped, and re-encoded as a small local JPEG.
- Restored avatars must be app-generated image data or an approved same-origin profile asset. Remote avatar URLs and SVG avatars are rejected.
- JSON backups are capped at 25 MB and strictly validated before storage. Unsafe object keys and malformed references are rejected.
- CSV imports are capped at 5 MB and 5,000 rows, with field length and numeric range validation.
- CSV exports escape spreadsheet formulas to reduce formula-injection risk.
- The service worker handles and caches only successful same-origin responses.
- Production source maps are disabled.
- GitHub Actions are pinned to immutable commit SHAs. The build job has read-only repository and Pages metadata access; Pages write and OIDC permissions are granted only to the deploy job.
- CI performs strict TypeScript checks, automated unit/integration tests, browser end-to-end tests, a production build, and an npm vulnerability audit.
- No secrets, private keys, API keys, passwords, or deployment tokens belong in source files, browser code, committed environment files, fixtures, screenshots, or exported sample data.

## Local data and privacy

Tournament data, player details, team rosters, ratings, and profile images are stored in browser `localStorage` in plaintext. This is persistence, not secure storage:

- anyone with access to the browser profile or an unlocked device may be able to read it;
- browser extensions, injected same-origin code, browser developer tools, or malware may be able to access it;
- clearing site data, using private browsing, changing browsers, or changing devices can remove or isolate it; and
- JSON, CSV, PDF, XLSX, PNG/JPG, PGN, and ZIP exports may contain personal or event information.

Use a trusted, updated browser and device account, lock the device, install only trusted extensions, collect only necessary personal data, keep backups in an appropriately protected location, and delete local/exported data when it is no longer needed. The application does not encrypt local data or exported files and should not be used as a secrets vault.

## Environment variables and secrets

No runtime or build-time environment variables are required. The deployed application must not depend on a client-side secret: every value bundled by Vite is downloadable by visitors. Do not add API keys or credentials through `VITE_*` variables or any other frontend configuration.

GitHub Pages deployment uses GitHub's short-lived OIDC token through the official Pages action. Repository maintainers should keep branch protections and GitHub account multi-factor authentication enabled and review dependency and workflow changes carefully.

## Controls that are not applicable

The following server-side controls are not present because the project intentionally has no backend:

- authentication, authorization, account recovery, roles, or tenant isolation;
- sessions, bearer tokens, refresh tokens, or application cookies;
- server-side CSRF protection or CORS policy;
- SQL/NoSQL injection, ORM hardening, database encryption, or database credentials;
- server command execution, shell injection, server filesystem path traversal, or upload directories;
- API endpoint authorization, server request validation, abuse throttling, or server rate limiting; and
- AI model access, prompt handling, retrieval, agents, or prompt-injection defenses.

These controls must be designed and reviewed before introducing any backend, remote API, cloud synchronization, authentication, analytics, or AI feature. Client-side checks must never be treated as authorization.

## Known limitations

- GitHub Pages does not allow this project to configure arbitrary HTTP response headers. The CSP is delivered through a `<meta>` element, so header-only directives such as `frame-ancestors` cannot be enforced. Effective clickjacking protection would require a host or edge layer that can send an appropriate CSP response header (and optionally `X-Frame-Options`).
- The application uses inline style attributes and therefore permits inline CSS in `style-src`; inline JavaScript remains blocked.
- GitHub Pages controls platform TLS and HTTP security headers. This repository cannot set HSTS, `Permissions-Policy`, or cross-origin isolation headers directly. A `no-referrer` policy is supplied through HTML, but a response header would provide earlier enforcement.
- `localStorage` is origin-wide, synchronous, unencrypted, and accessible to JavaScript running on the same origin. CSP and output encoding reduce exposure but cannot protect data after a same-origin compromise.
- Browser-side file-size checks reduce accidental or hostile resource use but cannot provide the isolation of a server-side malware-scanning pipeline.
- Offline service workers can temporarily serve a previously cached release. The app uses network-first navigation and versioned caches, but users may need to reconnect and reload to receive a security update.
- Dependency auditing detects known advisories; it does not prove that dependencies or generated exports are vulnerability-free.

## Maintainer checklist

Before release:

```bash
npm ci
npm audit --audit-level=high
npm run check
npm run build
npm run test:e2e
```

Also review the production bundle for source maps, scan the current tree and Git history for secrets, inspect dependency and workflow diffs, verify the service-worker cache version, and test backup/CSV/image rejection paths. Never commit a real credential; if one is exposed, revoke and rotate it immediately before rewriting history where appropriate.
