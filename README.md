# Aide iPhone

A production-ready progressive web app for remote iPhone assistance, plus a staff operations console. Users share device diagnostics, open support tickets and follow their resolution in real time. Administrators monitor live telemetry, process tickets, log interventions and broadcast push alerts.

No runtime build step, no framework and no bundler: plain HTML, modern CSS and ES modules, backed by Firebase (Auth, Firestore, Storage, Cloud Messaging and Cloud Functions v2). Tailwind utilities are precompiled into `tailwind.css`, so the app has no styling CDN dependency and works offline.

| App | URL after deployment |
| --- | --- |
| Client PWA | `https://kesakoyt.github.io/Aide-IPhone/` |
| Admin console | `https://kesakoyt.github.io/Aide-IPhone/admin.html` |

The static frontend is hosted on **GitHub Pages**; Firebase provides the backend (Auth, Firestore, Storage, Functions and FCM).

---

## Contents

- [Feature overview](#feature-overview)
- [Project structure](#project-structure)
- [Firebase services used](#firebase-services-used)
- [First-time setup](#first-time-setup)
- [Enable web push (VAPID)](#enable-web-push-vapid)
- [Deploy](#deploy)
- [Create the first administrator](#create-the-first-administrator)
- [Local development](#local-development)
- [Data model](#data-model)
- [Security model](#security-model)
- [PWA installation and push behaviour](#pwa-installation-and-push-behaviour)
- [Maintenance](#maintenance)
- [Troubleshooting](#troubleshooting)

---

## Feature overview

### Client (`index.html`, `app.js`)

- **Authentication** — email/password sign-up and sign-in, password reset, or a one-tap guest (anonymous) session. A guest can later link an email/password credential without losing tickets or history.
- **Live diagnostics** — periodic telemetry with GPS (opt-in), battery level/charging, estimated screen brightness, network type, device/platform, locale, time zone, local time and app version. Sharing can be paused; sensitive fields are deleted from Firestore when it is off.
- **Support tickets** — categories and priorities, up to 3 attachments (image, PDF or text, 8 MB each), automatic context snapshot, real-time status and technician updates.
- **Alerts** — critical/warning/info broadcasts shown as a blocking modal or an in-app banner, with per-user acknowledgement and a dedicated alerts view.
- **Guides** — 9 written tutorials, 3 official Apple Support videos and 6 FAQs, searchable and grouped by category.
- **Push notifications** — FCM token registration with a browser permission flow, foreground notifications and background delivery through the service worker.
- **Installable PWA** — manifest, shortcuts, offline shell caching, install prompt and an iOS "Add to Home Screen" guide.

### Admin (`admin.html`, `admin.js`)

- **Role-gated access** — only accounts whose `users/{uid}.role` is `admin` can sign in; the same check is enforced by Firestore, Storage and Cloud Functions.
- **Live dashboard** — KPI cards, online users, telemetry table and a Leaflet map with device markers and detail popups.
- **Ticket queue** — search/filter, assignment, status changes, technician replies, resolution notes and automatic intervention logging.
- **Intervention directory** — searchable/filterable history by date, technician, user, issue and resolution, plus manual entries.
- **Alerts and broadcasts** — compose info/warning/critical alerts, target everyone or selected users, schedule expiry, send a test push, resend a push, and review delivery summaries.
- **Exports** — CSV and JSON for tickets, interventions, telemetry, alerts and devices; full JSON snapshot. Every export is recorded in `auditLogs`.
- **Audit trail** — all administrative writes and exports are logged.

---

## Project structure

```
.
├── index.html                 Client PWA shell
├── admin.html                 Admin console shell
├── app.js                     Client application logic
├── admin.js                   Admin application logic
├── common.js                  Shared icons, domain metadata, UI helpers, CSV
├── firebase-config.js         Firebase bootstrap, constants, VAPID key
├── tutorials.js               Guides, videos and FAQs content
├── style.css                  Complete dark design system
├── tailwind.css               Precompiled Tailwind utilities (generated)
├── sw.js                      Service worker: caching + FCM background messages
├── manifest.json              PWA metadata, icons and shortcuts
├── icons/
│   ├── favicon-32.png          Icons8 Fluency favicon
│   ├── favicon-48.png
│   ├── icon-192.png            Installed-app icon
│   ├── icon-512.png
│   ├── icon-maskable-512.png
│   ├── apple-touch-icon.png
│   └── fluency/                Local Icons8 Fluency interface icons
├── firebase.json              Rules, indexes and Functions config (Hosting optional)
├── .nojekyll                  Required for GitHub Pages
├── .firebaserc                Default Firebase project (aide-iphone)
├── firestore.rules            Firestore security rules
├── storage.rules              Cloud Storage security rules
├── firestore.indexes.json     Composite indexes
├── functions/
│   ├── index.js               sendPush, alert trigger, ticket trigger
│   └── package.json           Node 22 dependencies
├── scripts/
│   ├── set-admin.js           Grant/revoke the admin role
│   ├── download-icons.ps1     Downloads the Icons8 Fluency interface set
│   ├── generate-icons.ps1     Generates PWA icons from the Icons8 help artwork
│   ├── tailwind.config.js     Tailwind content/theme config
│   ├── tailwind.input.css     Tailwind source file
│   └── package.json
└── README.md
```

---

## Firebase services used

| Service | Purpose |
| --- | --- |
| Authentication | Email/password and anonymous guest sessions |
| Cloud Firestore | Profiles, telemetry, tickets, interventions, alerts, tokens and audit logs |
| Cloud Storage | Ticket attachments under `tickets/{uid}/` |
| Cloud Messaging | Web push delivery |
| Cloud Functions v2 | Server-side push, alert fan-out and ticket notifications |
| Hosting | GitHub Pages serves the static frontend; Firebase Hosting remains optional |

The repository is pre-wired to the Firebase project **`aide-iphone`**. If you fork it to another project, update `firebase-config.js` (all fields, including `storageBucket`) and `.firebaserc`.

---

## First-time setup

### 1. Prerequisites

- Node.js 22+ (Node 22 is also the Functions runtime)
- A Firebase project on the **Blaze** plan (required for Cloud Functions and FCM send)
- Firebase CLI (`npm.cmd install -g firebase-tools` on Windows, `npm install -g firebase-tools` elsewhere)
- A Google account with Owner/Editor access to the project

### 2. Enable sign-in methods

Firebase Console → **Authentication → Sign-in method**:

1. Enable **Email/Password**.
2. Enable **Anonymous** (guest sessions).

### 3. Create the databases

1. **Firestore Database** → create a database in production mode. Region choice is permanent; `us-central1` keeps it close to the Functions.
2. **Storage** → get started. The configured bucket is `aide-iphone.firebasestorage.app` (new-style bucket). If your project uses `aide-iphone.appspot.com`, update `storageBucket` in `firebase-config.js`.

Rules and indexes are deployed from this repository; do not hand-edit them in the console.

### 4. Install project dependencies

```powershell
# Windows PowerShell
cd functions
npm.cmd install
cd ..\scripts
npm.cmd install
cd ..
```

```bash
# macOS / Linux
(cd functions && npm install)
(cd scripts && npm install)
```

### 5. Sign in to the CLI and select the project

```powershell
firebase login
firebase use aide-iphone
```

`.firebaserc` already sets `aide-iphone` as the default project, so `firebase use` is only needed if you switch projects.

---

## Enable web push (VAPID)

Push delivery needs a Web Push certificate. This is separate from the Firebase config and is **not** secret (it is a public key), but it must match the project.

1. Firebase Console → **Project settings → Cloud Messaging**.
2. Under **Web configuration → Web Push certificates**, click **Generate key pair**.
3. Copy the public key.
4. Paste it into `firebase-config.js`:

```js
export const VAPID_PUBLIC_KEY = "B...your-public-key...";
```

Until a key is present, the client still works: the push banner explains that notifications are not configured, and no FCM token is registered. Cloud Functions still deploy.

> FCM web push also requires the site to be served over HTTPS (or `localhost`) and the user to grant the notification permission. On iOS/iPadOS, web push requires **16.4 or later** and the PWA must be installed on the Home Screen.

---

## Deploy

The frontend is a static site hosted on **GitHub Pages**. Firebase provides Auth,
Firestore, Storage, Cloud Functions and FCM; no Firebase Hosting deployment is
required.

### 1. Authorize the GitHub Pages domain

Firebase Console → **Authentication → Settings → Authorized domains** → add:

```
kesakoyt.github.io
```

Without this, email/password and anonymous sign-in fail with
`auth/unauthorized-domain` on the Pages site. `localhost` is already authorized.

### 2. Deploy the Firebase backend

```powershell
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions
```

Functions read `APP_URL` when building push deep links. The default is
`https://kesakoyt.github.io/Aide-IPhone`; set the `APP_URL` environment variable
for Functions if you use a custom domain or fork the repository.

What gets deployed:

- **Functions** are pinned to **Node 22** and region **`us-central1`** (matching
  `FUNCTIONS_REGION` in `firebase-config.js`).
  - `sendPush` — callable, admin-only; test push and resend.
  - `onAlertCreated` — automatically pushes a newly created alert when `autoPush` is true.
  - `onTicketUpdated` — notifies the ticket owner when status or technician details change.
- **Rules and indexes** as defined in `firestore.rules`, `storage.rules` and
  `firestore.indexes.json`.

### 3. Publish the frontend on GitHub Pages

1. Commit the files in this repository and push to `main`.
2. Open the repository on GitHub → **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**, then **Save**.
5. Wait for the first deployment and open
   `https://kesakoyt.github.io/Aide-IPhone/`.

The included `.nojekyll` file disables Jekyll processing. All application URLs
are relative, so the site works at the `/Aide-IPhone/` subpath. The admin console
is `admin.html`; GitHub Pages does not need the Firebase Hosting `/admin`
rewrite.

Every push to `main` republishes the site. If you prefer Firebase Hosting, the
existing `firebase.json` hosting block still works via
`firebase deploy --only hosting`; use the Firebase URL in that case.

---

## Create the first administrator

There is deliberately no self-service admin sign-up. Use the provisioning script, which writes both `users/{uid}.role = "admin"` and a matching custom claim.

1. Authenticate with Application Default Credentials:

   ```powershell
   gcloud auth application-default login
   ```

   Or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON file with Firebase Auth and Firestore permissions. Never commit that file.

2. Grant access to an existing account:

   ```powershell
   cd scripts
   node set-admin.js admin@example.com
   ```

3. Or create the account and grant access in one step:

   ```powershell
   node set-admin.js admin@example.com "A-strong-password-123!" --create
   ```

4. Revoke access:

   ```powershell
   node set-admin.js admin@example.com --revoke
   ```

The script defaults to project `aide-iphone`; override with `FIREBASE_PROJECT_ID` or `GCLOUD_PROJECT`.

After changing a role, the administrator must **sign out and sign back in** so the refreshed ID token carries the new claim. The admin UI also re-reads `users/{uid}.role`, which is the authoritative check.

Open `https://kesakoyt.github.io/Aide-IPhone/admin.html` and sign in. A non-admin account sees an access-denied screen and cannot read admin collections.

---

## Local development

ES modules and service workers do not work from `file://`, so serve the folder over HTTP:

```powershell
npx.cmd serve . -l 8080
# or
python -m http.server 8080
```

Then open `http://localhost:8080/` and `http://localhost:8080/admin.html`.

To reproduce the GitHub Pages subpath exactly, serve the parent folder and open
`http://localhost:8000/Aide-IPhone/` and
`http://localhost:8000/Aide-IPhone/admin.html`:

```powershell
cd ..
python -m http.server 8000
```

- `localhost` is treated as a secure context, so the service worker and notification APIs work.
- The Firebase project is live, so local writes hit production data. Use a separate Firebase project for experiments.
- Firebase Hosting emulation is also possible: `firebase emulators:start --only hosting`.
- The client is a static app; there is no runtime build or watch step. Edit and reload. If you add Tailwind utility classes to the HTML/JS, rebuild the stylesheet with `cd scripts && npm run build:css`.

Useful query parameters:

| URL | Result |
| --- | --- |
| `/?view=support` | Open the support form directly |
| `/?view=alerts` | Open alerts |
| `/?view=guides` | Open guides |
| `/?source=pwa` | Manifest launch marker |

Notification links also include `alert=<id>` or `ticket=<id>`.

---

## Data model

All timestamps are Firestore `Timestamp` values unless noted.

### `users/{uid}`

`uid`, `email`, `displayName`, `role` (`user` \| `admin`), `createdAt`, `lastLogin`, `authProvider`, `photoURL`, `phone`.

### `telemetry/{uid}`

`uid`, `email`, `name`, `online`, `sharing`, `updatedAt`, `lastSeenClient`, `appVersion`, `time`, plus sensitive fields `gps`, `battery`, `display`, `device`, `permissions`, `platform`. Sensitive fields are removed with `deleteField()` when sharing is disabled. A user counts as online when `lastSeenClient` is within 5 minutes.

Example:

```js
{
  uid: "…",
  sharing: true,
  gps: { latitude: 48.8566, longitude: 2.3522, accuracy: 25, capturedAt: Timestamp },
  battery: { level: 0.72, charging: false, supported: true },
  display: { brightnessEstimate: 0.64, ambientLux: 120 },  // estimate, not a hardware reading
  device: { platform: "iOS", os: "iOS 18", browser: "Safari", … },
  time: { iso: "…", local: "…", timeZone: "Europe/Paris", offsetMinutes: 120 }
}
```

### `tickets/{ticketId}`

`userId`, `userEmail`, `userName`, `userIsGuest`, `category`, `subject`, `description`, `priority`, `status` (`pending` \| `in_progress` \| `resolved`), `attachments[]`, `context`, `createdAt`, `updatedAt`, `technicianId`, `technicianName`, `technicianMessage`, `resolution`, `resolvedAt`, `appVersion`, `userAgent`, `source`.

Attachments are stored at `tickets/{uid}/{timestamp}-{index}-{safeFileName}` and constrained to 8 MB and image/PDF/text content types.

### `interventions/{interventionId}`

`ticketId`, `userId`, `userName`, `userEmail`, `issue` (mirrored as `subject` for manual entries), `category`, `priority` (ticket-linked entries), `resolution`, `technicianId`, `technicianName`, `ticketCreatedAt`, `resolvedAt`, `createdAt`, `updatedAt`, `source` (`ticket` \| `manual`), `appVersion`.

### `alerts/{alertId}`

`title`, `message`, `severity` (`info` \| `warning` \| `critical`), `audience` (`all` \| `users`), `targetUids[]`, `createdBy`, `createdByName`, `createdAt`, `updatedAt`, `active`, `autoPush`, `expiresAt`, optional `pushSummary`.

Acknowledgements live at `alerts/{alertId}/acknowledgements/{uid}` with `uid`, `alertId`, `acknowledgedAt`, `appVersion`, `userAgent`.

### `fcmTokens/{sha256(token)}`

`uid`, `email`, `token`, `active`, `platform`, `userAgent`, `createdAt`, `updatedAt`. Invalid tokens are deactivated by Cloud Functions after a failed send.

### `auditLogs/{entryId}`

`action`, `actorId`, `actorName`, `actorEmail`, `targetType`, `targetId`, `details`, `createdAt`, `appVersion`. Written by admin actions, exports and the provisioning script; append-only.

### Composite indexes

All client and admin queries use a single `where` filter, a single `orderBy`, or no ordering at all, so Firestore's automatic single-field indexes are sufficient. `firestore.indexes.json` is intentionally empty. If a future query combines filters or a filter with an `orderBy`, add the matching composite index there and deploy it rather than creating it by hand in the console.

---

## Security model

- `users/{uid}.role` is the source of truth for admin access. A user can create only their own profile with `role: "user"`; only an admin can change roles.
- Clients may read only their own profile, telemetry, tickets and FCM tokens. Alerts are readable by any signed-in user because audience filtering happens client-side; alert contents are not considered secret.
- Clients can create tickets only for themselves, in `pending` status, with ≤3 attachments and no technician fields. All ticket updates are admin-only, which prevents users from forging a resolution.
- Storage reads are limited to the owner or an admin; writes require the owner and `metadata.ownerUid`.
- `auditLogs` are append-only for admins (no update/delete).
- Cloud Functions verify the admin role by reading `users/{uid}` server-side before sending push.
- The Firebase web config is public by design. Never commit service-account keys; the provisioning script uses ADC.

Before going to production, review the rules and test them in the Firestore/Storage rules playground or the emulator suite.

---

## PWA installation and push behaviour

### Android / desktop

Chrome, Edge and other Chromium browsers offer an install prompt in the address bar. The in-app install banner also appears when the `beforeinstallprompt` event fires. Install, open the app, then use **Enable notifications** in the alerts banner or the profile page.

### iPhone / iPad

1. Open the site in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch the app from the Home Screen (web push only works in standalone mode on iOS).
4. Open **Profile → Enable notifications** and grant permission.

### Delivery

- Foreground messages are shown as in-app toasts/modals by `app.js`.
- Background messages are rendered by `sw.js` using `firebase-messaging-sw.js`-compatible handlers at the root scope.
- Clicking a notification focuses/opens the app at `?view=alerts&alert=…` or `?view=support&ticket=…`.
- Critical alerts use a persistent notification and a stronger in-app presentation.

> Telemetry is only collected while the app is open (or briefly while the service worker wakes). A web app cannot continuously read GPS, battery or screen brightness in the background. Values are best-effort: brightness is estimated from ambient light where supported and is not a hardware measurement.

---

## Maintenance

- **Bump the service worker cache** when shell files change: edit `CACHE_VERSION` in `sw.js`. Bump `APP_VERSION` in `firebase-config.js` for visible release tracking.
- **Rebuild Tailwind** after adding or changing utility classes:

  ```powershell
  cd scripts
  npm.cmd run build:css
  ```

  The generated `tailwind.css` is committed, so deployment needs no Node build step.
- **Refresh the interface icons** after adding or changing an icon name:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\download-icons.ps1 -Force
  ```

  The script downloads the mapped Icons8 Fluency PNGs into `icons/fluency/`,
  validates that each file is 200×200, and requires no runtime CDN.
- **Regenerate the app icons** after changing the artwork or the brand background:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\generate-icons.ps1 -Force
  ```

  The script uses `System.Drawing` (no ImageMagick) and writes the 192/512,
  maskable 512, Apple touch and favicon PNGs from the Icons8 Fluency `help`
  artwork.
- **Update guides/videos/FAQs** in `tutorials.js`; they are rendered client-side.
- **Rotate the VAPID key** in the console and `firebase-config.js`. Existing tokens become stale; users re-enable notifications.
- **Review audit logs** regularly. There is no automatic retention policy; add a Firestore TTL policy on `auditLogs.createdAt` if you need one.

Icons are provided by [Icons8 Fluency](https://icons8.com/icons/set/fluency)
under the free license, which requires attribution. Keep this notice when
redistributing the project.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Admin login shows "access denied" | `users/{uid}.role` is not `admin`. Run `scripts/set-admin.js`, then sign out/in. |
| `auth/unauthorized-domain` on GitHub Pages | Add `kesakoyt.github.io` in Firebase Console → Authentication → Settings → Authorized domains. |
| GitHub Pages shows 404 | Confirm Pages is enabled for branch `main` / root, and use the `/Aide-IPhone/` subpath. Wait a minute after the first deployment. |
| `Missing or insufficient permissions` | Rules not deployed (`firebase deploy --only firestore:rules,storage`), or the profile document is missing. Check the browser console for the failing path. |
| Push banner says notifications are unavailable | `VAPID_PUBLIC_KEY` is empty, the browser lacks support, or permission was denied. On iOS, install the PWA first. |
| Push never arrives | Functions not deployed / project not on Blaze; VAPID key mismatch; service worker not active; token inactive. Try **Send test push** in the admin alerts view, then check `firebase functions:log`. |
| "The query requires an index" | Deploy `firestore.indexes.json`: `firebase deploy --only firestore:indexes`. Wait for the index build to finish. |
| Map is blank | Leaflet/CARTO assets blocked by an extension or offline. Telemetry without GPS cannot be mapped. |
| Attachments fail | Storage not enabled, bucket name mismatch, file >8 MB or unsupported type. |
| Stale UI after deploying | Old service worker cache. DevTools → Application → Service Workers → **Update**, or unregister and reload; also confirm `CACHE_VERSION` changed. |
| Service worker does not register locally | You opened `file://`. Use `http://localhost:8080`. |
| Functions deploy fails | Blaze plan required, Node 22 configured, and `functions/npm install` completed. Check `firebase functions:log` and the deploy output. |
| Guest loses data after clearing storage | Anonymous accounts are device-bound. Link an email before clearing site data. |
| Location stays unavailable | Permission denied, non-HTTPS origin, or the device has location services off. Other telemetry still works. |

---

## License

Private project. All rights reserved.
