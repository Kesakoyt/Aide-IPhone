/**
 * Aide iPhone — staff operations console.
 *
 * Responsibilities:
 *  - Administrator-only authentication (verified against users/{uid}.role)
 *  - Realtime telemetry, ticket, intervention, alert, audit and device listeners
 *  - Live map, KPI dashboard, ticket processing and intervention directory
 *  - Broadcast composition with audience targeting and push delivery
 *  - CSV / JSON exports with an audit trail
 *
 * Every write performed here is also written to the auditLogs collection.
 */

import {
  auth,
  db,
  functions,
  APP_VERSION,
  ONLINE_WINDOW_MS,
  VAPID_PUBLIC_KEY,
} from "./firebase-config.js";
import {
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  CATEGORIES,
  CATEGORY_MAP,
  PRIORITY_META,
  SEVERITY_META,
  STATUS_META,
  confirmDialog,
  copyText,
  debounce,
  downloadFile,
  escapeHtml,
  formatBytes,
  formatDate,
  formatDay,
  formatTime,
  friendlyAuthError,
  getInitials,
  icon,
  isOnline,
  openModal,
  qs,
  qsa,
  severityBadge,
  showToast,
  statusBadge,
  timeAgo,
  toCsv,
  toDate,
  toPlain,
  viewFromQuery,
} from "./common.js";

/* ==========================================================================
   Constants and state
   ========================================================================== */

const VIEWS = {
  dashboard: { title: "Dashboard", subtitle: "Live support operations" },
  tickets: { title: "Tickets", subtitle: "Support queue and processing" },
  interventions: { title: "Interventions", subtitle: "Resolution directory" },
  alerts: { title: "Broadcasts", subtitle: "Alerts and push delivery" },
  exports: { title: "Exports", subtitle: "Download operational data" },
};

const MAX_RECORDS = 500;
const LISTENER_TOTAL = 7;
const LOGIN_AUDIT_KEY = "aide.admin.loginAudit.v1";

const ACTION_VERBS = {
  admin_login: "signed in to the console",
  ticket_update: "updated a ticket",
  intervention_create: "added an intervention",
  alert_create: "published a broadcast",
  alert_toggle: "changed a broadcast",
  alert_delete: "deleted a broadcast",
  alert_push: "sent a push notification",
  export: "exported data",
};

const state = {
  user: null,
  profile: null,
  displayName: "Administrator",
  adminReady: false,
  started: false,
  currentView: "dashboard",
  pendingView: viewFromQuery(Object.keys(VIEWS)),
  deniedMessage: "",
  telemetry: [],
  users: [],
  tickets: [],
  interventions: [],
  alerts: [],
  audit: [],
  fcmTokens: [],
  unsubs: [],
  listeners: Object.create(null),
  listenerErrors: new Set(),
  lastUpdated: null,
  map: null,
  markers: new Map(),
  mapFitted: false,
  activeTicketId: null,
  selectedAudience: new Set(),
  drawer: null,
  filterEventsBound: false,
};

/* ==========================================================================
   Bootstrap and access control
   ========================================================================== */

async function init() {
  qsa("[data-app-version]").forEach((node) => {
    node.textContent = APP_VERSION;
  });

  bindEvents();
  updateNetworkUI();
  renderCategoryFilter();
  renderAlertPreview();
  renderAudienceList();
  renderAll();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./", updateViaCache: "none" })
      .catch((error) => console.warn("[Aide Admin] Service worker registration failed.", error));
  }

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("[Aide Admin] Could not set auth persistence.", error);
  }

  onAuthStateChanged(auth, (user) => {
    handleAuthState(user).catch((error) => {
      console.error("[Aide Admin] Access verification failed.", error);
      teardownConsole();
      hideBoot();
      showAuthScreen("Access could not be verified. Check your connection and try again.");
    });
  });
}

async function handleAuthState(user) {
  if (!user) {
    teardownConsole();
    hideBoot();
    const message = state.deniedMessage;
    state.deniedMessage = "";
    showAuthScreen(message);
    return;
  }

  if (state.adminReady && state.user?.uid === user.uid) {
    state.user = user;
    renderIdentity();
    return;
  }

  showBoot("Verifying staff access…");

  let snapshot;
  try {
    snapshot = await getDoc(doc(db, "users", user.uid));
  } catch (error) {
    console.error("[Aide Admin] Could not read the staff profile.", error);
    state.deniedMessage = "Your staff profile could not be loaded. Check your connection and try again.";
    showAuthScreen(state.deniedMessage);
    await signOut(auth).catch(() => {});
    teardownConsole();
    hideBoot();
    return;
  }

  if (!snapshot.exists() || snapshot.data().role !== "admin") {
    state.deniedMessage =
      "This account does not have administrator access. Ask the workspace owner to grant the admin role.";
    showAuthScreen(state.deniedMessage);
    await signOut(auth).catch(() => {});
    teardownConsole();
    hideBoot();
    return;
  }

  state.user = user;
  state.profile = snapshot.data();
  state.displayName =
    state.profile.displayName || user.displayName || (user.email ? user.email.split("@")[0] : "Administrator");
  state.adminReady = true;

  showConsole();
  renderIdentity();
  startConsole();
  hideBoot();
}

function startConsole() {
  if (state.started) {
    return;
  }
  state.started = true;
  bindFilterEvents();
  renderCategoryFilter();
  startListeners();
  initMap();
  writeLoginAudit();

  const target = state.pendingView && VIEWS[state.pendingView] ? state.pendingView : "dashboard";
  state.pendingView = null;
  goTo(target, { scroll: false });
}

function showConsole() {
  qs("#adminAuthScreen")?.classList.add("hidden");
  qs("#adminShell")?.classList.remove("hidden");
}

function showAuthScreen(message = "") {
  qs("#adminShell")?.classList.add("hidden");
  qs("#adminAuthScreen")?.classList.remove("hidden");
  const error = qs("#adminAuthError");
  if (error) {
    error.textContent = message;
    error.classList.toggle("hidden", !message);
  }
  const password = qs("#adminPassword");
  if (password) password.value = "";
  const submit = qs("#adminLoginBtn");
  setBusy(submit, false);
}

function showBoot(caption = "Verifying staff access…") {
  const boot = qs("#adminBootScreen");
  if (!boot) return;
  setText("#adminBootCaption", caption);
  boot.classList.remove("is-done");
  boot.setAttribute("aria-hidden", "false");
}

function hideBoot() {
  const boot = qs("#adminBootScreen");
  if (!boot) return;
  boot.classList.add("is-done");
  setTimeout(() => boot.setAttribute("aria-hidden", "true"), 400);
}

function renderIdentity() {
  const email = state.user?.email || "";
  const name = state.displayName || "Administrator";
  setText("#adminSidebarName", name);
  setText("#adminSidebarEmail", email || "No email on file");
  setText("#adminSidebarInitials", getInitials(name || email, "A"));
  setText("#adminTopInitials", getInitials(name || email, "A"));
}

async function handleLogin(event) {
  event.preventDefault();
  const email = qs("#adminEmail")?.value.trim() || "";
  const password = qs("#adminPassword")?.value || "";
  const error = qs("#adminAuthError");
  error?.classList.add("hidden");
  state.deniedMessage = "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (error) {
      error.textContent = "Enter a valid staff email address.";
      error.classList.remove("hidden");
    }
    qs("#adminEmail")?.focus();
    return;
  }
  if (password.length < 6) {
    if (error) {
      error.textContent = "Enter your password.";
      error.classList.remove("hidden");
    }
    qs("#adminPassword")?.focus();
    return;
  }

  const button = qs("#adminLoginBtn");
  setBusy(button, true);
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (loginError) {
    console.warn("[Aide Admin] Sign-in failed.", loginError);
    if (error) {
      error.textContent = friendlyAuthError(loginError);
      error.classList.remove("hidden");
    }
    setBusy(button, false);
  }
}

async function handleSignOut() {
  const confirmed = await confirmDialog({
    title: "Sign out of the console?",
    message: "Live listeners will stop and this device will need to sign in again to access administration.",
    confirmLabel: "Sign out",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await signOut(auth);
    showToast("Signed out of the administration console.", "info");
  } catch (error) {
    console.error("[Aide Admin] Sign out failed.", error);
    showToast("Could not sign out. Please try again.", "error");
  }
}

function teardownConsole() {
  closeDrawer();
  state.unsubs.forEach((unsubscribe) => {
    try {
      unsubscribe();
    } catch {
      /* Listener may already be detached. */
    }
  });
  if (state.map) {
    try {
      state.map.remove();
    } catch {
      /* Map may already be disposed. */
    }
  }
  state.unsubs = [];
  state.listeners = Object.create(null);
  state.listenerErrors.clear();
  state.telemetry = [];
  state.users = [];
  state.tickets = [];
  state.interventions = [];
  state.alerts = [];
  state.audit = [];
  state.fcmTokens = [];
  state.lastUpdated = null;
  state.map = null;
  state.markers = new Map();
  state.mapFitted = false;
  state.activeTicketId = null;
  state.selectedAudience = new Set();
  state.user = null;
  state.profile = null;
  state.displayName = "Administrator";
  state.adminReady = false;
  state.started = false;
  renderAll();
}

async function writeLoginAudit() {
  try {
    const previous = JSON.parse(sessionStorage.getItem(LOGIN_AUDIT_KEY) || "null");
    if (previous && previous.uid === state.user?.uid && Date.now() - previous.at < 30 * 60_000) {
      return;
    }
    sessionStorage.setItem(LOGIN_AUDIT_KEY, JSON.stringify({ uid: state.user?.uid, at: Date.now() }));
  } catch {
    /* Session storage may be unavailable. */
  }
  void logAudit("admin_login", { details: "Opened the administration console" });
}

/* ==========================================================================
   Realtime listeners
   ========================================================================== */

function startListeners() {
  const specs = [
    {
      name: "users",
      ref: query(collection(db, "users"), limit(MAX_RECORDS)),
      apply: (documents) => {
        state.users = documents;
      },
    },
    {
      name: "telemetry",
      ref: query(collection(db, "telemetry"), orderBy("updatedAt", "desc"), limit(MAX_RECORDS)),
      apply: (documents) => {
        state.telemetry = documents;
      },
    },
    {
      name: "tickets",
      ref: query(collection(db, "tickets"), orderBy("createdAt", "desc"), limit(MAX_RECORDS)),
      apply: (documents) => {
        state.tickets = documents;
      },
    },
    {
      name: "interventions",
      ref: query(collection(db, "interventions"), orderBy("createdAt", "desc"), limit(MAX_RECORDS)),
      apply: (documents) => {
        state.interventions = documents;
      },
    },
    {
      name: "alerts",
      ref: query(collection(db, "alerts"), orderBy("createdAt", "desc"), limit(200)),
      apply: (documents) => {
        state.alerts = documents;
      },
    },
    {
      name: "auditLogs",
      ref: query(collection(db, "auditLogs"), orderBy("createdAt", "desc"), limit(100)),
      apply: (documents) => {
        state.audit = documents;
      },
    },
    {
      name: "fcmTokens",
      ref: query(collection(db, "fcmTokens"), where("active", "==", true), limit(1000)),
      apply: (documents) => {
        state.fcmTokens = documents;
      },
    },
  ];

  for (const spec of specs) {
    const unsubscribe = onSnapshot(
      spec.ref,
      (snapshot) => {
        spec.apply(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
        markListener(spec.name, true);
        state.lastUpdated = new Date();
        renderAll();
      },
      (error) => {
        console.warn(`[Aide Admin] Listener "${spec.name}" failed.`, error);
        markListener(spec.name, false);
        if (!state.listenerErrors.has(spec.name)) {
          state.listenerErrors.add(spec.name);
          const message =
            error?.code === "permission-denied"
              ? "Firestore denied access to some administration data. Check the security rules."
              : `Live ${spec.name} updates are unavailable.`;
          showToast(message, "warning", 6500);
        }
        renderAll();
      },
    );
    state.unsubs.push(unsubscribe);
  }
  renderListenerStatus();
}

function markListener(name, active) {
  state.listeners[name] = active;
  renderListenerStatus();
}

function renderListenerStatus() {
  const active = Object.values(state.listeners).filter(Boolean).length;
  const label = active ? `${active} of ${LISTENER_TOTAL} active` : state.started ? "Connecting…" : "Idle";
  setText("#listenerStatus", label);
}

/* ==========================================================================
   Navigation
   ========================================================================== */

function goTo(view, { scroll = true } = {}) {
  if (!VIEWS[view]) view = "dashboard";
  state.currentView = view;

  qsa("[data-admin-view]").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.adminView !== view);
  });
  qsa("[data-admin-nav]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.adminNav === view);
  });

  setText("#adminTopTitle", VIEWS[view].title);
  setText("#adminTopSubtitle", VIEWS[view].subtitle);
  document.title = `Aide iPhone — ${VIEWS[view].title}`;

  try {
    const url = new URL(location.href);
    if (view === "dashboard") url.searchParams.delete("view");
    else url.searchParams.set("view", view);
    history.replaceState(null, "", url);
  } catch {
    /* History may be unavailable in a sandboxed frame. */
  }

  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });

  if (view === "dashboard") {
    setTimeout(() => state.map?.invalidateSize(), 120);
  }
  if (view === "tickets") renderTickets();
  if (view === "interventions") renderInterventions();
  if (view === "alerts") {
    renderAlerts();
    renderAudienceList();
  }
  if (view === "exports") renderExportCounts();
}

/* ==========================================================================
   Map
   ========================================================================== */

function initMap() {
  if (state.map || !window.L) {
    if (!window.L) {
      setText("#mapBadge", "Unavailable");
      const empty = qs("#mapEmpty");
      if (empty) {
        empty.innerHTML =
          '<div><p class="font-semibold text-slate-300">Map library unavailable</p><p class="mt-1">Leaflet could not load. Check your connection and reload.</p></div>';
      }
    }
    return;
  }

  const element = qs("#liveMap");
  if (!element) return;

  const map = window.L.map(element, {
    zoomControl: true,
    attributionControl: true,
    worldCopyJump: true,
    minZoom: 2,
  }).setView([25, 8], 2);

  window.L
    .tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 20,
      detectRetina: true,
    })
    .addTo(map);

  state.map = map;
  setTimeout(() => map.invalidateSize(), 200);
  updateMap();
}

function locatedTelemetry() {
  return state.telemetry.filter((entry) => {
    if (entry.sharing === false) return false;
    const latitude = Number(entry.gps?.latitude);
    const longitude = Number(entry.gps?.longitude);
    return Number.isFinite(latitude) && Number.isFinite(longitude);
  });
}

function updateMap() {
  const located = locatedTelemetry();
  setText("#mapBadge", `${located.length} located`);
  qs("#mapEmpty")?.classList.toggle("hidden", located.length > 0);

  if (!state.map || !window.L) return;

  const seen = new Set();
  for (const entry of located) {
    const id = entry.id;
    seen.add(id);
    const latitude = Number(entry.gps.latitude);
    const longitude = Number(entry.gps.longitude);
    const online = isTelemetryOnline(entry);
    let marker = state.markers.get(id);

    if (!marker) {
      marker = window.L.marker([latitude, longitude], {
        icon: window.L.divIcon({
          className: "map-marker",
          html: `<span class="map-pin ${online ? "online" : "offline"}"></span>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -8],
        }),
        title: nameForTelemetry(entry),
      });
      marker.addTo(state.map);
      state.markers.set(id, marker);
    } else {
      marker.setLatLng([latitude, longitude]);
      marker.setIcon(
        window.L.divIcon({
          className: "map-marker",
          html: `<span class="map-pin ${online ? "online" : "offline"}"></span>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
          popupAnchor: [0, -8],
        }),
      );
    }

    marker.bindPopup(mapPopupMarkup(entry, online), { closeButton: true, maxWidth: 260 });
  }

  for (const [id, marker] of state.markers.entries()) {
    if (seen.has(id)) continue;
    marker.remove();
    state.markers.delete(id);
  }

  if (!state.mapFitted && located.length) {
    state.mapFitted = true;
    if (located.length === 1) {
      state.map.setView([Number(located[0].gps.latitude), Number(located[0].gps.longitude)], 13, {
        animate: false,
      });
    } else {
      const bounds = window.L.latLngBounds(
        located.map((entry) => [Number(entry.gps.latitude), Number(entry.gps.longitude)]),
      );
      state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13, animate: false });
    }
  }
}

function mapPopupMarkup(entry, online) {
  const name = nameForTelemetry(entry);
  const seen = entry.lastSeenClient || entry.updatedAt;
  const battery = entry.battery || {};
  const batteryLabel = battery.supported
    ? `${Math.round(Number(battery.percent ?? battery.level * 100) || 0)}%${battery.charging ? " · charging" : ""}`
    : "Battery unavailable";
  return `<h3>${escapeHtml(name)}</h3>
    <p>${online ? "Online now" : `Away · ${escapeHtml(timeAgo(seen))}`}</p>
    <p>${escapeHtml(batteryLabel)}</p>
    <p>${escapeHtml(formatDate(seen))}</p>
    <button type="button" class="btn btn-secondary btn-sm" style="margin-top:.45rem" data-open-user="${escapeHtml(entry.id)}">
      Open user
    </button>`;
}

/* ==========================================================================
   Dashboard
   ========================================================================== */

function renderAll() {
  renderKpis();
  renderDashboardTickets();
  renderLiveUsers();
  renderActivity();
  renderPushCounters();
  renderExportCounts();
  renderTickets();
  renderInterventions();
  renderAlerts();
  renderAudienceList();
  renderListenerStatus();
  updateMap();
  setText("#lastUpdateLabel", state.lastUpdated ? formatTime(state.lastUpdated) : "—");
}

function renderKpis() {
  const online = state.telemetry.filter(isTelemetryOnline);
  const open = state.tickets.filter((ticket) => ticket.status !== "resolved");
  const pending = open.filter((ticket) => ticket.status === "pending").length;
  const inProgress = open.filter((ticket) => ticket.status === "in_progress").length;
  const urgent = open.filter((ticket) => ticket.priority === "urgent");
  const high = open.filter((ticket) => ticket.priority === "high").length;
  const waiting = open.filter((ticket) => {
    const created = toDate(ticket.createdAt);
    return created && Date.now() - created.getTime() > 24 * 3_600_000;
  }).length;
  const active = state.alerts.filter(alertIsActive);
  const critical = active.filter((alert) => alert.severity === "critical").length;
  const sharing = state.telemetry.filter((entry) => entry.sharing !== false && entry.online !== false).length;
  const located = locatedTelemetry().length;

  setText("#kpiOnline", String(online.length));
  setText(
    "#kpiOnlineHint",
    state.telemetry.length
      ? `${sharing} sharing diagnostics · ${located} on the map`
      : "Waiting for telemetry…",
  );

  setText("#kpiOpenTickets", String(open.length));
  setText(
    "#kpiOpenTicketsHint",
    open.length ? `${pending} pending · ${inProgress} in progress` : "Nothing waiting",
  );

  setText("#kpiUrgent", String(urgent.length));
  setText("#kpiUrgentHint", urgent.length ? `${high} high priority · ${waiting} waiting >24h` : "No urgent tickets");

  setText("#kpiActiveAlerts", String(active.length));
  setText(
    "#kpiActiveAlertsHint",
    active.length ? `${critical} critical · ${state.alerts.length} total` : "No active notices",
  );

  setText("#navTicketCount", String(open.length));
  setText("#navAlertCount", String(active.length));
}

function renderDashboardTickets() {
  const body = qs("#dashboardTicketBody");
  if (!body) return;
  const tickets = state.tickets.filter((ticket) => ticket.status !== "resolved").slice(0, 6);
  if (!tickets.length) {
    body.innerHTML = `<tr><td colspan="4">
      <div class="empty-state py-5">
        <span class="empty-state-icon">${icon("check-circle", "h-5 w-5")}</span>
        <h3>Queue is clear</h3>
        <p>No unresolved tickets right now.</p>
      </div>
    </td></tr>`;
    return;
  }
  body.innerHTML = tickets
    .map(
      (ticket) => `<tr data-admin-ticket="${escapeHtml(ticket.id)}" tabindex="0">
        <td>
          <div class="cell-main">${escapeHtml(ticket.userName || "User")}</div>
          <div class="cell-sub">${escapeHtml(ticket.userEmail || "Guest session")}</div>
        </td>
        <td>
          <div class="cell-main">${escapeHtml(ticket.subject || "Support request")}</div>
          <div class="cell-sub">${escapeHtml(categoryLabel(ticket.category))}</div>
        </td>
        <td>${statusBadge(ticket.status)}</td>
        <td>
          <div class="cell-main">${escapeHtml(formatDate(ticket.createdAt))}</div>
          <div class="cell-sub">${escapeHtml(timeAgo(ticket.createdAt))}</div>
        </td>
      </tr>`,
    )
    .join("");
}

function renderLiveUsers() {
  const container = qs("#liveUsersList");
  if (!container) return;

  const sorted = sortedTelemetry();
  setText("#liveUsersCount", String(sorted.filter(isTelemetryOnline).length));

  if (!sorted.length) {
    const fallback = [...state.users]
      .sort((a, b) => (toDate(b.lastLogin)?.getTime() || 0) - (toDate(a.lastLogin)?.getTime() || 0))
      .slice(0, 6);
    if (fallback.length) {
      container.innerHTML = fallback
        .map(
          (user) => `<button type="button" class="live-user" data-open-user="${escapeHtml(user.id)}">
            <span class="status-dot" style="background:#64748b"></span>
            <span class="min-w-0 flex-1">
              <p class="user-name">${escapeHtml(user.displayName || user.email || "User")}</p>
              <p class="user-meta">No telemetry yet · ${escapeHtml(user.role || "user")}</p>
            </span>
            <span class="user-stats"><span>${icon("clock", "h-3 w-3")} ${escapeHtml(timeAgo(user.lastLogin))}</span></span>
          </button>`,
        )
        .join("");
      return;
    }
    container.innerHTML = `<div class="empty-state py-5">
      <span class="empty-state-icon">${icon("users", "h-5 w-5")}</span>
      <h3>No devices yet</h3>
      <p>People appear here after opening the client app.</p>
    </div>`;
    return;
  }

  container.innerHTML = sorted
    .slice(0, 8)
    .map((entry) => {
      const online = isTelemetryOnline(entry);
      const battery = entry.battery || {};
      const batteryLabel = battery.supported
        ? `${Math.round(Number(battery.percent ?? battery.level * 100) || 0)}%`
        : null;
      const hasLocation =
        Number.isFinite(Number(entry.gps?.latitude)) && Number.isFinite(Number(entry.gps?.longitude));
      return `<button type="button" class="live-user" data-open-user="${escapeHtml(entry.id)}">
        <span class="status-dot" style="background:${online ? "#34d399" : "#64748b"};box-shadow:${
          online ? "0 0 0 4px rgba(52,211,153,.14)" : "none"
        }"></span>
        <span class="min-w-0 flex-1">
          <p class="user-name">${escapeHtml(nameForTelemetry(entry))}</p>
          <p class="user-meta">${escapeHtml(entry.platform || entry.device?.os || "Unknown device")} · ${escapeHtml(
            online ? "online" : timeAgo(entry.lastSeenClient || entry.updatedAt),
          )}</p>
        </span>
        <span class="user-stats">
          ${batteryLabel ? `<span>${icon("battery", "h-3 w-3")} ${escapeHtml(batteryLabel)}</span>` : ""}
          ${hasLocation ? `<span>${icon("map-pin", "h-3 w-3")} GPS</span>` : ""}
        </span>
      </button>`;
    })
    .join("");
}

function renderActivity() {
  const container = qs("#activityList");
  if (!container) return;
  const entries = state.audit.slice(0, 6);
  if (!entries.length) {
    container.innerHTML = `<div class="loading-line">No administrative activity yet.</div>`;
    return;
  }
  container.innerHTML = entries
    .map(
      (entry) => `<div class="activity-item">
        <span class="activity-dot"></span>
        <div class="min-w-0 flex-1">
          <p><strong>${escapeHtml(entry.actorName || "Staff")}</strong> ${escapeHtml(
            ACTION_VERBS[entry.action] || entry.action || "performed an action",
          )}${entry.details ? ` <span>· ${escapeHtml(truncate(entry.details, 90))}</span>` : ""}</p>
          <p class="text-[0.62rem] text-slate-600">${escapeHtml(timeAgo(entry.createdAt))}</p>
        </div>
      </div>`,
    )
    .join("");
}

function renderPushCounters() {
  const count = state.fcmTokens.length;
  setText("#pushDeviceCount", String(count));
  setText("#pushDeviceCountPanel", String(count));
  const channel = VAPID_PUBLIC_KEY ? "FCM configured" : "VAPID key required";
  setText("#pushChannelStatus", channel);
  setText("#pushChannelPanel", channel);
}

/* ==========================================================================
   Tickets
   ========================================================================== */

function renderCategoryFilter() {
  const select = qs("#ticketCategoryFilter");
  if (!select || select.dataset.filled === "true") return;
  select.insertAdjacentHTML(
    "beforeend",
    CATEGORIES.map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.label)}</option>`).join(""),
  );
  select.dataset.filled = "true";
}

function filteredTickets() {
  const search = (qs("#ticketSearch")?.value || "").trim().toLowerCase();
  const status = qs("#ticketStatusFilter")?.value || "all";
  const category = qs("#ticketCategoryFilter")?.value || "all";
  const priority = qs("#ticketPriorityFilter")?.value || "all";
  const range = qs("#ticketDateFilter")?.value || "all";

  return state.tickets.filter((ticket) => {
    if (status !== "all" && ticket.status !== status) return false;
    if (category !== "all" && ticket.category !== category) return false;
    if (priority !== "all" && ticket.priority !== priority) return false;
    if (!withinDateRange(ticket.createdAt, range)) return false;
    if (!search) return true;
    const haystack = [
      ticket.id,
      ticket.subject,
      ticket.description,
      ticket.userName,
      ticket.userEmail,
      ticket.userId,
      ticket.technicianName,
      categoryLabel(ticket.category),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function renderTickets() {
  const body = qs("#ticketTableBody");
  if (!body) return;
  const tickets = filteredTickets();
  const empty = qs("#ticketsEmpty");
  empty?.classList.toggle("hidden", tickets.length > 0);
  setText(
    "#ticketResultCount",
    state.tickets.length
      ? `${tickets.length} of ${state.tickets.length} ticket${state.tickets.length === 1 ? "" : "s"}`
      : "No tickets received yet",
  );

  body.innerHTML = tickets
    .map(
      (ticket) => `<tr data-admin-ticket="${escapeHtml(ticket.id)}" tabindex="0">
        <td>
          <div class="cell-main">${escapeHtml(ticket.userName || "User")}</div>
          <div class="cell-sub">${escapeHtml(ticket.userEmail || "Guest session")}</div>
        </td>
        <td>
          <div class="cell-main">${escapeHtml(ticket.subject || "Support request")}</div>
          <div class="cell-sub">#${escapeHtml(ticket.id.slice(0, 6).toUpperCase())} · ${escapeHtml(
            categoryLabel(ticket.category),
          )}</div>
        </td>
        <td>${statusBadge(ticket.status)}</td>
        <td>${priorityBadge(ticket.priority)}</td>
        <td>
          <div class="cell-main">${escapeHtml(formatDate(ticket.createdAt))}</div>
          <div class="cell-sub">${escapeHtml(timeAgo(ticket.createdAt))}</div>
        </td>
        <td>${escapeHtml(ticket.technicianName || "Unassigned")}</td>
      </tr>`,
    )
    .join("");
}

function openTicketDrawer(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) {
    showToast("That ticket is no longer available.", "info");
    return;
  }

  const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];
  const attachmentMarkup = attachments.length
    ? `<div class="mt-3 space-y-2">${attachments
        .map((file) => {
          const url = safeHttpUrl(file.url);
          return `<div class="attachment-item">
            ${icon("paperclip", "h-3.5 w-3.5")}
            <span class="file-name">${escapeHtml(file.name || "Attachment")}</span>
            <span>${escapeHtml(formatBytes(Number(file.size) || 0))}</span>
            ${
              url
                ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open ${icon(
                    "external-link",
                    "h-3 w-3",
                  )}</a>`
                : `<span class="text-[0.65rem] text-slate-500">Unavailable</span>`
            }
          </div>`;
        })
        .join("")}</div>`
    : `<p class="help-text mt-2">No attachments were provided.</p>`;

  const body = `<div class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      ${statusBadge(ticket.status)}
      ${priorityBadge(ticket.priority)}
      <span class="badge badge-neutral">${escapeHtml(categoryLabel(ticket.category))}</span>
      <span class="mono ml-auto text-[0.65rem] text-slate-500">#${escapeHtml(ticket.id.slice(0, 6).toUpperCase())}</span>
    </div>

    <div class="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p class="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-slate-500">Reported issue</p>
      <p class="mt-1 whitespace-pre-wrap text-[0.8rem] leading-6 text-slate-300">${escapeHtml(
        ticket.description || "No description provided.",
      )}</p>
    </div>

    ${detailGrid([
      ["User", ticket.userName || "User"],
      ["Email", ticket.userEmail || (ticket.userIsGuest ? "Guest session" : "Not provided")],
      ["Created", formatDate(ticket.createdAt)],
      ["Updated", formatDate(ticket.updatedAt)],
      ["Resolved", ticket.resolvedAt ? formatDate(ticket.resolvedAt) : "Not resolved"],
      ["App version", ticket.appVersion || "Unknown"],
    ])}

    <div>
      <h3 class="text-[0.72rem] font-bold uppercase tracking-[0.1em] text-slate-500">Attachments</h3>
      ${attachmentMarkup}
    </div>

    <div>
      <h3 class="text-[0.72rem] font-bold uppercase tracking-[0.1em] text-slate-500">Captured diagnostics</h3>
      ${contextGrid(ticket.context || {})}
    </div>

    <form id="ticketProcessForm" novalidate>
      <h3 class="text-[0.72rem] font-bold uppercase tracking-[0.1em] text-slate-500">Process ticket</h3>
      <div id="ticketProcessError" class="form-error mt-2 hidden" role="alert"></div>
      <div class="mt-2 grid gap-3 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="ticketStatusSelect">Status</label>
          <select id="ticketStatusSelect" class="select">
            ${Object.entries(STATUS_META)
              .map(
                ([value, meta]) =>
                  `<option value="${escapeHtml(value)}" ${ticket.status === value ? "selected" : ""}>${escapeHtml(
                    meta.label,
                  )}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="field">
          <label class="label" for="ticketPrioritySelect">Priority</label>
          <select id="ticketPrioritySelect" class="select">
            ${Object.entries(PRIORITY_META)
              .map(
                ([value, meta]) =>
                  `<option value="${escapeHtml(value)}" ${
                    (ticket.priority || "normal") === value ? "selected" : ""
                  }>${escapeHtml(meta.label)}</option>`,
              )
              .join("")}
          </select>
        </div>
      </div>

      <div class="field mt-3">
        <label class="label" for="ticketTechnicianName">Technician</label>
        <input id="ticketTechnicianName" class="input" type="text" maxlength="80" value="${escapeHtml(
          ticket.technicianName || state.displayName,
        )}" placeholder="Technician name" />
      </div>

      <div class="field mt-3">
        <label class="label" for="ticketTechnicianMessage">Message to user</label>
        <textarea id="ticketTechnicianMessage" class="textarea" rows="3" maxlength="800" placeholder="Optional update shown in the ticket detail">${escapeHtml(
          ticket.technicianMessage || "",
        )}</textarea>
      </div>

      <div class="field mt-3">
        <label class="label" for="ticketResolution">Resolution <span class="req">*</span></label>
        <textarea id="ticketResolution" class="textarea" rows="4" maxlength="2000" placeholder="Required when the status is Resolved">${escapeHtml(
          ticket.resolution || "",
        )}</textarea>
        <p class="help-text">A resolution of at least 10 characters is saved to the intervention directory.</p>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn btn-ghost btn-sm" data-open-user="${escapeHtml(ticket.userId)}">
          ${icon("user", "h-3.5 w-3.5")} Open user
        </button>
        <button type="button" class="btn btn-ghost btn-sm" data-admin-action="copy-ticket">
          ${icon("copy", "h-3.5 w-3.5")} Copy summary
        </button>
      </div>
    </form>
  </div>`;

  const footer = `<div class="flex flex-wrap items-center gap-2">
    <span class="help-text mr-auto">Changes reach the user in real time.</span>
    <button type="button" class="btn btn-secondary btn-sm" data-drawer-close>Close</button>
    <button type="submit" form="ticketProcessForm" class="btn btn-primary btn-sm" id="ticketSaveBtn">Save update</button>
  </div>`;

  const drawer = openDrawer({
    title: ticket.subject || "Support request",
    subtitle: `${ticket.userName || "User"} · #${ticket.id.slice(0, 6).toUpperCase()}`,
    body,
    footer,
    onMount: (drawerInstance) => {
      drawerInstance.root.querySelector("#ticketProcessForm")?.addEventListener("submit", saveTicketUpdate);
      drawerInstance.root.querySelector("#ticketStatusSelect")?.addEventListener("change", (event) => {
        const resolution = drawerInstance.root.querySelector("#ticketResolution");
        if (resolution) resolution.placeholder =
          event.target.value === "resolved" ? "Describe the fix in at least 10 characters" : "Required only when resolving";
      });
      const status = drawerInstance.root.querySelector("#ticketStatusSelect");
      if (resolutionRequired(status?.value)) {
        drawerInstance.root.querySelector("#ticketResolution")?.setAttribute("aria-required", "true");
      }
    },
  });
  if (drawer) state.activeTicketId = ticket.id;
}

async function saveTicketUpdate(event) {
  event.preventDefault();
  const ticket = state.tickets.find((item) => item.id === state.activeTicketId);
  if (!ticket) {
    showToast("This ticket is no longer available.", "error");
    return;
  }

  const status = qs("#ticketStatusSelect")?.value || ticket.status;
  const priority = qs("#ticketPrioritySelect")?.value || ticket.priority || "normal";
  const technicianName = qs("#ticketTechnicianName")?.value.trim() || state.displayName;
  const technicianMessage = qs("#ticketTechnicianMessage")?.value.trim() || "";
  const resolution = qs("#ticketResolution")?.value.trim() || "";
  const errorBox = qs("#ticketProcessError");
  const button = qs("#ticketSaveBtn");

  if (!STATUS_META[status]) {
    showInlineError(errorBox, "Choose a valid ticket status.");
    return;
  }
  if (status === "resolved" && resolution.length < 10) {
    showInlineError(errorBox, "Describe the resolution in at least 10 characters before resolving.");
    qs("#ticketResolution")?.focus();
    return;
  }
  errorBox?.classList.add("hidden");

  const alreadyResolved = ticket.status === "resolved";
  setBusy(button, true);
  try {
    const update = {
      status,
      priority,
      technicianId: state.user.uid,
      technicianName,
      technicianMessage: technicianMessage || null,
      resolution: status === "resolved" ? resolution : null,
      resolvedAt:
        status === "resolved"
          ? alreadyResolved && ticket.resolvedAt
            ? ticket.resolvedAt
            : serverTimestamp()
          : null,
      updatedAt: serverTimestamp(),
    };
    await updateDoc(doc(db, "tickets", ticket.id), update);

    if (status === "resolved") {
      const interventionRef = doc(db, "interventions", `ticket-${ticket.id}`);
      const existing = await getDoc(interventionRef);
      await setDoc(
        interventionRef,
        {
          ticketId: ticket.id,
          userId: ticket.userId || "",
          userName: ticket.userName || "User",
          userEmail: ticket.userEmail || "",
          category: ticket.category || "other",
          priority,
          issue: ticket.subject || "Support request",
          resolution,
          technicianId: state.user.uid,
          technicianName,
          ticketCreatedAt: ticket.createdAt || null,
          resolvedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          source: "ticket",
          ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
        },
        { merge: true },
      );
    }

    void logAudit("ticket_update", {
      targetType: "ticket",
      targetId: ticket.id,
      details: `#${ticket.id.slice(0, 6).toUpperCase()} moved from ${statusLabel(
        ticket.status,
      )} to ${statusLabel(status)}${status === "resolved" ? " and resolved" : ""}`,
    });

    showToast(
      status === "resolved" ? "Ticket resolved and saved to the intervention directory." : "Ticket updated.",
      "success",
    );
    closeDrawer();
  } catch (error) {
    console.error("[Aide Admin] Ticket update failed.", error);
    showInlineError(
      errorBox,
      error?.code === "permission-denied"
        ? "You do not have permission to update tickets."
        : error?.message || "The ticket could not be updated. Please try again.",
    );
  } finally {
    setBusy(button, false);
  }
}

/* ==========================================================================
   Users
   ========================================================================== */

function openUserDrawer(uid) {
  const user = state.users.find((item) => item.id === uid);
  const entry = state.telemetry.find((item) => item.id === uid);
  if (!user && !entry) {
    showToast("That user profile is unavailable.", "info");
    return;
  }

  const name = user?.displayName || (entry ? nameForTelemetry(entry) : "User");
  const email = user?.email || entry?.email || "No email on file";
  const online = entry ? isTelemetryOnline(entry) : false;
  const tickets = state.tickets.filter((ticket) => ticket.userId === uid).slice(0, 4);

  const profileGrid = detailGrid([
    ["Name", name],
    ["Email", email],
    ["Role", user?.role || "user"],
    ["Access", user?.authProvider || (ticketGuestLabel(uid) ? "anonymous" : "password")],
    ["Member since", user?.createdAt ? formatDate(user.createdAt) : "Unknown"],
    ["Last sign-in", user?.lastLogin ? formatDate(user.lastLogin) : "Unknown"],
  ]);

  let telemetryMarkup = `<p class="help-text mt-3">No telemetry has been received from this device.</p>`;
  if (entry) {
    const gps = entry.gps || {};
    const battery = entry.battery || {};
    const display = entry.display || {};
    const time = entry.time || {};
    const permissions = entry.permissions || {};
    const located = Number.isFinite(Number(gps.latitude)) && Number.isFinite(Number(gps.longitude));
    const mapUrl = located
      ? `https://www.openstreetmap.org/?mlat=${encodeURIComponent(gps.latitude)}&mlon=${encodeURIComponent(
          gps.longitude,
        )}#map=16/${encodeURIComponent(gps.latitude)}/${encodeURIComponent(gps.longitude)}`
      : "";
    telemetryMarkup = `<div class="mt-3 flex flex-wrap items-center gap-2">
        <span class="badge ${online ? "badge-resolved" : "badge-neutral"}">${online ? "Online" : "Away"}</span>
        <span class="badge badge-neutral">${escapeHtml(entry.sharing === false ? "Sharing off" : "Sharing diagnostics")}</span>
        ${
          mapUrl
            ? `<a class="btn btn-ghost btn-sm" href="${escapeHtml(
                mapUrl,
              )}" target="_blank" rel="noopener noreferrer">${icon("map-pin", "h-3 w-3")} Open map</a>`
            : ""
        }
      </div>
      ${detailGrid([
        ["Last seen", entry.lastSeenClient ? formatDate(entry.lastSeenClient) : formatDate(entry.updatedAt)],
        ["Platform", entry.platform || `${entry.device?.os || "Unknown"} · ${entry.device?.browser || "Browser"}`],
        [
          "Battery",
          battery.supported
            ? `${Math.round(Number(battery.percent ?? battery.level * 100) || 0)}%${
                battery.charging ? " · charging" : ""
              }`
            : battery.reason || "Unavailable",
        ],
        [
          "Location",
          located
            ? `${Number(gps.latitude).toFixed(5)}, ${Number(gps.longitude).toFixed(5)}${
                gps.accuracy ? ` · ±${Math.round(gps.accuracy)} m` : ""
              }`
            : gps.error || "Unavailable",
        ],
        [
          "Display",
          display.brightnessPercent != null
            ? `${display.brightnessPercent}% · ${display.darkMode ? "dark" : "light"} appearance`
            : "Unavailable",
        ],
        ["Time", time.localTime ? `${time.localTime} · ${time.timezone}` : "Unavailable"],
        [
          "Permissions",
          `Location ${permissions.geolocation || "unknown"} · Notifications ${permissions.notifications || "unknown"}`,
        ],
        ["App version", entry.appVersion || "Unknown"],
      ])}`;
  }

  const ticketMarkup = tickets.length
    ? `<div class="mt-3 space-y-2">${tickets
        .map(
          (ticket) => `<button type="button" class="mini-ticket" data-admin-ticket="${escapeHtml(ticket.id)}">
            <span class="status-dot" style="background:${
              ticket.status === "resolved" ? "#34d399" : ticket.status === "in_progress" ? "#22d3ee" : "#fbbf24"
            }"></span>
            <span class="mini-title">${escapeHtml(ticket.subject || "Support request")}</span>
            ${statusBadge(ticket.status)}
          </button>`,
        )
        .join("")}</div>`
    : `<p class="help-text mt-2">No support tickets from this user.</p>`;

  openDrawer({
    title: name,
    subtitle: email,
    body: `<div class="flex items-center gap-3">
        <span class="avatar" style="width:2.6rem;height:2.6rem">${escapeHtml(getInitials(name || email, "U"))}</span>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-slate-100">${escapeHtml(name)}</p>
          <p class="truncate text-[0.7rem] text-slate-500">${escapeHtml(email)}</p>
        </div>
      </div>
      ${profileGrid}
      ${telemetryMarkup}
      <h3 class="mt-4 text-[0.72rem] font-bold uppercase tracking-[0.1em] text-slate-500">Recent tickets</h3>
      ${ticketMarkup}`,
    footer: `<div class="flex flex-wrap items-center gap-2">
      <button type="button" class="btn btn-secondary btn-sm" data-admin-action="copy-user-email">${icon(
        "copy",
        "h-3.5 w-3.5",
      )} Copy email</button>
      <span class="flex-1"></span>
      <button type="button" class="btn btn-primary btn-sm" data-drawer-close>Close</button>
    </div>`,
  });
}

/* ==========================================================================
   Interventions
   ========================================================================== */

function interventionDate(intervention) {
  return intervention.resolvedAt || intervention.createdAt || intervention.date;
}

function filteredInterventions() {
  const search = (qs("#interventionSearch")?.value || "").trim().toLowerCase();
  const fromValue = qs("#interventionFrom")?.value || "";
  const toValue = qs("#interventionTo")?.value || "";
  const technician = qs("#interventionTechnician")?.value || "all";
  const from = fromValue ? new Date(`${fromValue}T00:00:00`) : null;
  const to = toValue ? new Date(`${toValue}T23:59:59.999`) : null;

  return state.interventions.filter((intervention) => {
    if (technician !== "all" && intervention.technicianName !== technician) return false;
    const date = toDate(interventionDate(intervention));
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    if (!search) return true;
    const haystack = [
      intervention.id,
      intervention.userName,
      intervention.userEmail,
      intervention.userId,
      intervention.issue,
      intervention.subject,
      intervention.resolution,
      intervention.technicianName,
      intervention.ticketId,
      categoryLabel(intervention.category),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(search);
  });
}

function renderInterventions() {
  const body = qs("#interventionTableBody");
  if (!body) return;

  const technicianSelect = qs("#interventionTechnician");
  if (technicianSelect) {
    const current = technicianSelect.value || "all";
    const names = [...new Set(state.interventions.map((item) => item.technicianName).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b),
    );
    const signature = names.join("|");
    if (technicianSelect.dataset.signature !== signature) {
      technicianSelect.innerHTML = `<option value="all">All technicians</option>${names
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join("")}`;
      technicianSelect.dataset.signature = signature;
      technicianSelect.value = names.includes(current) ? current : "all";
    }
  }

  const interventions = filteredInterventions();
  const empty = qs("#interventionsEmpty");
  empty?.classList.toggle("hidden", interventions.length > 0);
  setText(
    "#interventionResultCount",
    state.interventions.length
      ? `${interventions.length} of ${state.interventions.length} intervention${
          state.interventions.length === 1 ? "" : "s"
        }`
      : "No interventions recorded yet",
  );

  body.innerHTML = interventions
    .map(
      (intervention) => `<tr data-intervention-id="${escapeHtml(intervention.id)}" tabindex="0">
        <td>
          <div class="cell-main">${escapeHtml(formatDay(interventionDate(intervention)))}</div>
          <div class="cell-sub">${escapeHtml(timeAgo(interventionDate(intervention)))}</div>
        </td>
        <td>
          <div class="cell-main">${escapeHtml(intervention.userName || "User")}</div>
          <div class="cell-sub">${escapeHtml(intervention.userEmail || "No email")}</div>
        </td>
        <td>
          <div class="cell-main">${escapeHtml(intervention.issue || intervention.subject || "Support request")}</div>
          <div class="cell-sub">${escapeHtml(categoryLabel(intervention.category))}</div>
        </td>
        <td>${escapeHtml(intervention.technicianName || "Unassigned")}</td>
        <td><div class="cell-main" style="max-width:20rem">${escapeHtml(
          truncate(intervention.resolution || "No resolution recorded", 110),
        )}</div></td>
        <td class="mono">${
          intervention.ticketId ? `#${escapeHtml(String(intervention.ticketId).slice(0, 6).toUpperCase())}` : "—"
        }</td>
      </tr>`,
    )
    .join("");
}

function openInterventionDrawer(interventionId) {
  const intervention = state.interventions.find((item) => item.id === interventionId);
  if (!intervention) {
    showToast("That intervention is no longer available.", "info");
    return;
  }
  const linkedTicket = state.tickets.find((ticket) => ticket.id === intervention.ticketId);
  openDrawer({
    title: intervention.issue || intervention.subject || "Intervention",
    subtitle: `${intervention.userName || "User"} · ${formatDay(interventionDate(intervention))}`,
    body: `<div class="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <p class="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-slate-500">Resolution</p>
        <p class="mt-1 whitespace-pre-wrap text-[0.8rem] leading-6 text-slate-300">${escapeHtml(
          intervention.resolution || "No resolution recorded.",
        )}</p>
      </div>
      ${detailGrid([
        ["User", intervention.userName || "User"],
        ["Email", intervention.userEmail || "Not provided"],
        ["Technician", intervention.technicianName || "Unassigned"],
        ["Category", categoryLabel(intervention.category)],
        ["Recorded", formatDate(intervention.createdAt)],
        ["Resolved", intervention.resolvedAt ? formatDate(intervention.resolvedAt) : formatDate(intervention.createdAt)],
        ["Source", intervention.source === "manual" ? "Manual entry" : "Linked ticket"],
        ["Ticket", intervention.ticketId ? `#${String(intervention.ticketId).slice(0, 6).toUpperCase()}` : "None"],
      ])}
      ${linkedTicket ? `<p class="help-text mt-2">The linked ticket is still available in the queue.</p>` : ""}`,
    footer: `<div class="flex flex-wrap items-center gap-2">
      <button type="button" class="btn btn-secondary btn-sm" data-admin-action="copy-resolution">${icon(
        "copy",
        "h-3.5 w-3.5",
      )} Copy resolution</button>
      ${
        intervention.ticketId
          ? `<button type="button" class="btn btn-ghost btn-sm" data-admin-ticket="${escapeHtml(
              intervention.ticketId,
            )}">Open ticket</button>`
          : ""
      }
      <span class="flex-1"></span>
      <button type="button" class="btn btn-primary btn-sm" data-drawer-close>Close</button>
    </div>`,
  });
}

function openNewInterventionModal() {
  const modal = openModal({
    title: "New intervention",
    subtitle: "Record a fix manually when no ticket exists.",
    body: `<form id="interventionForm" class="space-y-3" novalidate>
      <div id="interventionFormError" class="form-error hidden" role="alert"></div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="interventionUserName">User name <span class="req">*</span></label>
          <input id="interventionUserName" class="input" type="text" maxlength="80" required />
        </div>
        <div class="field">
          <label class="label" for="interventionUserEmail">User email</label>
          <input id="interventionUserEmail" class="input" type="email" maxlength="120" placeholder="Optional" />
        </div>
      </div>
      <div class="field">
        <label class="label" for="interventionIssue">Issue <span class="req">*</span></label>
        <input id="interventionIssue" class="input" type="text" maxlength="140" placeholder="Short description of the problem" required />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="interventionTechnicianInput">Technician</label>
          <input id="interventionTechnicianInput" class="input" type="text" maxlength="80" value="${escapeHtml(
            state.displayName,
          )}" />
        </div>
        <div class="field">
          <label class="label" for="interventionDateInput">Date resolved</label>
          <input id="interventionDateInput" class="input date-input" type="datetime-local" value="${escapeHtml(
            localDateTimeValue(new Date()),
          )}" />
        </div>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="field">
          <label class="label" for="interventionCategoryInput">Category</label>
          <select id="interventionCategoryInput" class="select">
            ${CATEGORIES.map(
              (category) =>
                `<option value="${escapeHtml(category.id)}" ${
                  category.id === "other" ? "selected" : ""
                }>${escapeHtml(category.label)}</option>`,
            ).join("")}
          </select>
        </div>
        <div class="field">
          <label class="label" for="interventionTicketInput">Ticket ID</label>
          <input id="interventionTicketInput" class="input" type="text" maxlength="120" placeholder="Optional" />
        </div>
      </div>
      <div class="field">
        <label class="label" for="interventionResolutionInput">Resolution <span class="req">*</span></label>
        <textarea id="interventionResolutionInput" class="textarea" rows="5" maxlength="2000" placeholder="What was wrong and how was it fixed?" required></textarea>
      </div>
    </form>`,
    footer: `<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
      <button type="submit" class="btn btn-primary" form="interventionForm" id="interventionSaveBtn">Save intervention</button>`,
    size: "lg",
  });

  modal.root.querySelector("[data-cancel]")?.addEventListener("click", () => modal.close());
  modal.root.querySelector("#interventionForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorBox = qs("#interventionFormError");
    const userName = qs("#interventionUserName")?.value.trim() || "";
    const userEmail = qs("#interventionUserEmail")?.value.trim() || "";
    const issue = qs("#interventionIssue")?.value.trim() || "";
    const technicianName = qs("#interventionTechnicianInput")?.value.trim() || state.displayName;
    const resolution = qs("#interventionResolutionInput")?.value.trim() || "";
    const category = qs("#interventionCategoryInput")?.value || "other";
    const ticketId = qs("#interventionTicketInput")?.value.trim() || "";
    const dateValue = qs("#interventionDateInput")?.value || "";
    const button = qs("#interventionSaveBtn");

    if (userName.length < 2) {
      showInlineError(errorBox, "Enter the user's name.");
      return;
    }
    if (issue.length < 4) {
      showInlineError(errorBox, "Describe the issue in at least 4 characters.");
      return;
    }
    if (resolution.length < 10) {
      showInlineError(errorBox, "Describe the resolution in at least 10 characters.");
      return;
    }
    const resolvedDate = dateValue ? new Date(dateValue) : new Date();
    if (Number.isNaN(resolvedDate.getTime())) {
      showInlineError(errorBox, "Choose a valid resolution date.");
      return;
    }
    errorBox?.classList.add("hidden");

    setBusy(button, true);
    try {
      await addDoc(collection(db, "interventions"), {
        ticketId: ticketId || null,
        userId: null,
        userName,
        userEmail,
        issue,
        subject: issue,
        category,
        resolution,
        technicianId: state.user.uid,
        technicianName,
        resolvedAt: Timestamp.fromDate(resolvedDate),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        source: "manual",
        appVersion: APP_VERSION,
      });
      void logAudit("intervention_create", {
        targetType: "intervention",
        details: `Manual entry for ${userName}: ${issue}`,
      });
      modal.close();
      showToast("Intervention recorded.", "success");
    } catch (error) {
      console.error("[Aide Admin] Intervention creation failed.", error);
      showInlineError(
        errorBox,
        error?.code === "permission-denied"
          ? "You do not have permission to create interventions."
          : error?.message || "The intervention could not be saved.",
      );
    } finally {
      setBusy(button, false);
    }
  });
}

/* ==========================================================================
   Broadcasts
   ========================================================================== */

function alertIsActive(alert) {
  if (alert.active === false) return false;
  const expires = toDate(alert.expiresAt);
  return !expires || expires.getTime() > Date.now();
}

function alertStatusMeta(alert) {
  const expires = toDate(alert.expiresAt);
  if (expires && expires.getTime() <= Date.now()) {
    return { label: "Expired", badge: "badge-neutral" };
  }
  if (alert.active === false) return { label: "Inactive", badge: "badge-neutral" };
  return { label: "Active", badge: "badge-resolved" };
}

function alertAudienceLabel(alert) {
  if (!alert.audience || alert.audience === "all") return "All users";
  const count = Array.isArray(alert.targetUids) ? alert.targetUids.length : 0;
  return `${count} user${count === 1 ? "" : "s"}`;
}

function renderAlerts() {
  const body = qs("#alertHistoryBody");
  if (!body) return;
  setText(
    "#alertHistoryCount",
    `${state.alerts.length} alert${state.alerts.length === 1 ? "" : "s"}`,
  );
  qs("#alertsEmpty")?.classList.toggle("hidden", state.alerts.length > 0);

  body.innerHTML = state.alerts
    .map((alert) => {
      const status = alertStatusMeta(alert);
      return `<tr>
        <td>
          <div class="cell-main">${escapeHtml(formatDate(alert.createdAt))}</div>
          <div class="cell-sub">${escapeHtml(alert.createdByName || "Staff")}</div>
        </td>
        <td>
          <div class="cell-main">${escapeHtml(alert.title || "Untitled alert")}</div>
          <div class="cell-sub">${escapeHtml(truncate(alert.message || "", 90))}</div>
        </td>
        <td>${severityBadge(alert.severity)}</td>
        <td>${escapeHtml(alertAudienceLabel(alert))}</td>
        <td><span class="badge ${status.badge}">${escapeHtml(status.label)}</span></td>
        <td>
          <div class="flex flex-wrap gap-1">
            <button type="button" class="btn btn-ghost btn-sm" data-alert-action="view" data-alert-id="${escapeHtml(
              alert.id,
            )}">View</button>
            <button type="button" class="btn btn-ghost btn-sm" data-alert-action="toggle" data-alert-id="${escapeHtml(
              alert.id,
            )}">${alert.active === false ? "Activate" : "Deactivate"}</button>
            <button type="button" class="btn btn-ghost btn-sm" data-alert-action="push" data-alert-id="${escapeHtml(
              alert.id,
            )}">Push</button>
            <button type="button" class="btn btn-ghost btn-sm text-rose-300" data-alert-action="delete" data-alert-id="${escapeHtml(
              alert.id,
            )}">Delete</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

function renderAudienceList() {
  const container = qs("#audienceList");
  if (!container) return;
  const search = (qs("#audienceSearch")?.value || "").trim().toLowerCase();
  const users = [...state.users]
    .filter((user) => {
      if (!search) return true;
      return `${user.displayName || ""} ${user.email || ""}`.toLowerCase().includes(search);
    })
    .sort((a, b) => (a.displayName || a.email || "").localeCompare(b.displayName || b.email || ""));

  if (!users.length) {
    container.innerHTML = `<p class="help-text p-2">${state.users.length ? "No users match that search." : "Users appear after they open the client app."}</p>`;
    setText("#audienceCount", `${state.selectedAudience.size} selected`);
    return;
  }

  container.innerHTML = users
    .slice(0, 100)
    .map(
      (user) => `<label class="audience-user">
        <input type="checkbox" data-audience-uid="${escapeHtml(user.id)}" ${
          state.selectedAudience.has(user.id) ? "checked" : ""
        } />
        <span class="min-w-0 truncate">${escapeHtml(user.displayName || user.email || "User")}</span>
        <span class="au-meta">${escapeHtml(user.email || user.role || "")}</span>
      </label>`,
    )
    .join("");
  setText("#audienceCount", `${state.selectedAudience.size} selected`);
}

function renderAlertPreview() {
  const title = qs("#alertTitle")?.value.trim() || "";
  const message = qs("#alertMessage")?.value || "";
  const severity = qs("#alertSeverity")?.value || "info";
  const audience = qs("#alertAudience")?.value || "all";
  const meta = SEVERITY_META[severity] || SEVERITY_META.info;

  setText("#alertPreviewTitle", title || "Your alert title");
  setText("#alertPreviewMessage", message || "Your message will appear here as you type.");
  setText("#alertMessageCount", String(message.length));

  const severityPreview = qs("#alertPreviewSeverity");
  if (severityPreview) {
    severityPreview.className = `badge ${meta.badge}`;
    severityPreview.textContent = meta.label;
  }
  setText(
    "#alertPreviewAudience",
    audience === "all"
      ? "All users"
      : `${state.selectedAudience.size} selected user${state.selectedAudience.size === 1 ? "" : "s"}`,
  );
  qs("#alertAudienceWrap")?.classList.toggle("hidden", audience !== "users");
}

async function publishAlert(event) {
  event.preventDefault();
  const errorBox = qs("#alertFormError");
  const title = qs("#alertTitle")?.value.trim() || "";
  const message = qs("#alertMessage")?.value.trim() || "";
  const severity = qs("#alertSeverity")?.value || "info";
  const audience = qs("#alertAudience")?.value || "all";
  const active = Boolean(qs("#alertActive")?.checked);
  const autoPush = Boolean(qs("#alertAutoPush")?.checked);
  const expiresValue = qs("#alertExpires")?.value || "";
  const button = qs("#alertSubmitBtn");

  if (title.length < 4) {
    showInlineError(errorBox, "Give the alert a title of at least 4 characters.");
    qs("#alertTitle")?.focus();
    return;
  }
  if (message.length < 10) {
    showInlineError(errorBox, "Write a message of at least 10 characters.");
    qs("#alertMessage")?.focus();
    return;
  }
  if (!SEVERITY_META[severity]) {
    showInlineError(errorBox, "Choose a valid severity.");
    return;
  }
  if (audience === "users" && state.selectedAudience.size === 0) {
    showInlineError(errorBox, "Select at least one recipient, or send to all users.");
    return;
  }
  const expiresDate = expiresValue ? new Date(expiresValue) : null;
  if (expiresDate && Number.isNaN(expiresDate.getTime())) {
    showInlineError(errorBox, "Choose a valid expiry date.");
    return;
  }
  if (expiresDate && expiresDate.getTime() <= Date.now()) {
    showInlineError(errorBox, "The expiry date must be in the future.");
    return;
  }
  errorBox?.classList.add("hidden");

  setBusy(button, true);
  try {
    await addDoc(collection(db, "alerts"), {
      title,
      message,
      severity,
      audience,
      targetUids: audience === "users" ? [...state.selectedAudience] : [],
      createdBy: state.user.uid,
      createdByName: state.displayName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      active,
      autoPush,
      expiresAt: expiresDate ? Timestamp.fromDate(expiresDate) : null,
    });

    void logAudit("alert_create", {
      targetType: "alert",
      details: `${severity.toUpperCase()} alert "${title}" to ${
        audience === "users" ? `${state.selectedAudience.size} users` : "all users"
      }${autoPush ? " with push delivery" : ""}`,
    });

    qs("#alertForm")?.reset();
    state.selectedAudience.clear();
    renderAudienceList();
    renderAlertPreview();
    showToast(
      autoPush
        ? VAPID_PUBLIC_KEY
          ? "Alert published. Push delivery has been queued."
          : "Alert published. Add a VAPID key to enable push delivery."
        : "Alert published.",
      "success",
      6000,
    );
  } catch (error) {
    console.error("[Aide Admin] Alert publish failed.", error);
    showInlineError(
      errorBox,
      error?.code === "permission-denied"
        ? "You do not have permission to publish alerts."
        : error?.message || "The alert could not be published.",
    );
  } finally {
    setBusy(button, false);
  }
}

function openAlertModal(alertId) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) {
    showToast("That broadcast is unavailable.", "info");
    return;
  }
  const status = alertStatusMeta(alert);
  const push = alert.pushSummary || null;
  openModal({
    title: alert.title || "Broadcast",
    subtitle: `${SEVERITY_META[alert.severity]?.label || "Information"} · ${formatDate(alert.createdAt)}`,
    body: `<div class="flex flex-wrap items-center gap-2">
        <span class="badge ${status.badge}">${escapeHtml(status.label)}</span>
        <span class="badge badge-neutral">${escapeHtml(alertAudienceLabel(alert))}</span>
        ${alert.autoPush ? `<span class="badge badge-info">Push requested</span>` : ""}
      </div>
      <p class="mt-3 whitespace-pre-wrap text-[0.82rem] leading-6 text-slate-300">${escapeHtml(alert.message || "")}</p>
      ${detailGrid([
        ["Created by", alert.createdByName || "Staff"],
        ["Expires", alert.expiresAt ? formatDate(alert.expiresAt) : "Never"],
        ["Push status", push ? push.status || "Recorded" : alert.autoPush ? "Awaiting delivery" : "Not requested"],
        ["Delivered", push && Number.isFinite(push.sentCount) ? `${push.sentCount} device(s)` : "—"],
        ["Failures", push && Number.isFinite(push.failedCount) ? `${push.failedCount} device(s)` : "—"],
      ])}
      ${
        alert.audience === "users" && Array.isArray(alert.targetUids) && alert.targetUids.length
          ? `<p class="help-text mt-3">Recipients: ${alert.targetUids
              .map((uid) => escapeHtml(nameForUid(uid)))
              .join(", ")}</p>`
          : ""
      }`,
    footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button>
      <button type="button" class="btn btn-primary" data-alert-resend="${escapeHtml(alert.id)}">Resend push</button>`,
    size: "md",
  }).root.querySelector("[data-alert-resend]")?.addEventListener("click", (event) => {
    event.currentTarget.closest(".modal-layer")?.querySelector("[data-modal-close]")?.click();
    void resendAlertPush(alert.id, event.currentTarget);
  });
}

async function toggleAlert(alertId, button) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) return;
  setBusy(button, true);
  try {
    await updateDoc(doc(db, "alerts", alert.id), {
      active: alert.active === false,
      updatedAt: serverTimestamp(),
    });
    void logAudit("alert_toggle", {
      targetType: "alert",
      targetId: alert.id,
      details: `${alert.active === false ? "Activated" : "Deactivated"} "${alert.title || "Untitled alert"}"`,
    });
    showToast(alert.active === false ? "Broadcast activated." : "Broadcast deactivated.", "success");
  } catch (error) {
    console.error("[Aide Admin] Alert toggle failed.", error);
    showToast("The broadcast could not be updated.", "error");
  } finally {
    setBusy(button, false);
  }
}

async function deleteAlert(alertId, button) {
  const alert = state.alerts.find((item) => item.id === alertId);
  if (!alert) return;
  const confirmed = await confirmAction({
    title: "Delete this broadcast?",
    message: `“${alert.title || "Untitled alert"}” will be removed immediately. Acknowledgements stored under the alert remain in Firestore.`,
    confirmLabel: "Delete broadcast",
    danger: true,
  });
  if (!confirmed) return;
  setBusy(button, true);
  try {
    await deleteDoc(doc(db, "alerts", alert.id));
    void logAudit("alert_delete", {
      targetType: "alert",
      targetId: alert.id,
      details: `Deleted "${alert.title || "Untitled alert"}"`,
    });
    showToast("Broadcast deleted.", "success");
  } catch (error) {
    console.error("[Aide Admin] Alert deletion failed.", error);
    showToast("The broadcast could not be deleted.", "error");
  } finally {
    setBusy(button, false);
  }
}

async function resendAlertPush(alertId, button) {
  if (!alertId) return;
  setBusy(button, true);
  try {
    const result = await callPush({ alertId, force: true });
    const sent = Number(result?.sentCount) || 0;
    const failed = Number(result?.failedCount) || 0;
    showToast(`Push requested for ${sent} device(s)${failed ? `; ${failed} failed` : ""}.`, failed ? "warning" : "success");
  } catch (error) {
    console.error("[Aide Admin] Push resend failed.", error);
    showToast(friendlyAuthError(error), "error", 6500);
  } finally {
    setBusy(button, false);
  }
}

async function sendTestPush(button) {
  setBusy(button, true);
  setText("#pushTestHint", "Sending a test notification…");
  try {
    const result = await callPush({ test: true });
    const sent = Number(result?.sentCount) || 0;
    setText("#pushTestHint", sent ? `Test sent to ${sent} registered device(s).` : "No registered devices were found.");
    showToast(sent ? "Test push sent." : "No active push tokens were found.", sent ? "success" : "warning", 6000);
  } catch (error) {
    console.error("[Aide Admin] Test push failed.", error);
    const message = friendlyAuthError(error);
    setText("#pushTestHint", message);
    showToast(message, "error", 7000);
  } finally {
    setBusy(button, false);
  }
}

async function callPush(payload) {
  const callable = httpsCallable(functions, "sendPush");
  const response = await callable(payload);
  const data = response?.data || {};
  if (data.ok === false) throw new Error(data.error || "The push request was rejected.");
  return data;
}

/* ==========================================================================
   Exports and audit
   ========================================================================== */

function renderExportCounts() {
  setText("#exportCountTickets", String(state.tickets.length));
  setText("#exportCountInterventions", String(state.interventions.length));
  setText("#exportCountTelemetry", String(state.telemetry.length));
  setText("#exportCountUsers", String(state.users.length));
  setText("#exportCountAlerts", String(state.alerts.length));
  setText("#exportCountAudit", String(state.audit.length));
}

function exportDataset(dataset, format) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const definitions = {
    tickets: {
      label: "tickets",
      rows: state.tickets,
      columns: [
        { key: "id", label: "Ticket ID" },
        { key: "status", label: "Status", get: (row) => statusLabel(row.status) },
        { key: "priority", label: "Priority", get: (row) => PRIORITY_META[row.priority]?.label || row.priority || "" },
        { key: "category", label: "Category", get: (row) => categoryLabel(row.category) },
        { key: "subject", label: "Subject" },
        { key: "description", label: "Description" },
        { key: "userName", label: "User" },
        { key: "userEmail", label: "Email" },
        { key: "userId", label: "User ID" },
        { key: "createdAt", label: "Created", get: (row) => (row.createdAt ? formatDate(row.createdAt) : "") },
        { key: "updatedAt", label: "Updated", get: (row) => (row.updatedAt ? formatDate(row.updatedAt) : "") },
        { key: "technicianName", label: "Technician" },
        { key: "technicianMessage", label: "Technician message" },
        { key: "resolution", label: "Resolution" },
        { key: "resolvedAt", label: "Resolved", get: (row) => (row.resolvedAt ? formatDate(row.resolvedAt) : "") },
        { key: "appVersion", label: "App version" },
        {
          key: "attachments",
          label: "Attachments",
          get: (row) => (Array.isArray(row.attachments) ? row.attachments.length : 0),
        },
        { key: "context", label: "Captured context" },
      ],
    },
    interventions: {
      label: "interventions",
      rows: state.interventions,
      columns: [
        { key: "id", label: "Intervention ID" },
        { key: "resolvedAt", label: "Date", get: (row) => formatDate(interventionDate(row)) },
        { key: "userName", label: "User" },
        { key: "userEmail", label: "Email" },
        { key: "issue", label: "Issue", get: (row) => row.issue || row.subject || "" },
        { key: "resolution", label: "Resolution" },
        { key: "technicianName", label: "Technician" },
        { key: "category", label: "Category", get: (row) => categoryLabel(row.category) },
        { key: "ticketId", label: "Ticket ID" },
        { key: "source", label: "Source" },
      ],
    },
    telemetry: {
      label: "telemetry",
      rows: state.telemetry,
      columns: [
        { key: "id", label: "User ID" },
        { key: "name", label: "Name" },
        { key: "email", label: "Email" },
        { key: "online", label: "Online", get: (row) => (isTelemetryOnline(row) ? "Yes" : "No") },
        { key: "sharing", label: "Sharing diagnostics" },
        { key: "lastSeenClient", label: "Last seen", get: (row) => formatDate(row.lastSeenClient || row.updatedAt) },
        { key: "batteryPercent", label: "Battery %", get: (row) => row.battery?.percent ?? "" },
        { key: "batteryCharging", label: "Charging", get: (row) => (row.battery?.charging ? "Yes" : "No") },
        { key: "latitude", label: "Latitude", get: (row) => row.gps?.latitude ?? "" },
        { key: "longitude", label: "Longitude", get: (row) => row.gps?.longitude ?? "" },
        { key: "accuracy", label: "GPS accuracy (m)", get: (row) => row.gps?.accuracy ?? "" },
        { key: "brightness", label: "Brightness %", get: (row) => row.display?.brightnessPercent ?? "" },
        { key: "platform", label: "Platform" },
        { key: "os", label: "OS", get: (row) => row.device?.os || "" },
        { key: "browser", label: "Browser", get: (row) => row.device?.browser || "" },
        { key: "timezone", label: "Timezone", get: (row) => row.time?.timezone || "" },
        { key: "localTime", label: "Local time", get: (row) => row.time?.localTime || "" },
        { key: "appVersion", label: "App version" },
      ],
    },
    users: {
      label: "users",
      rows: state.users,
      columns: [
        { key: "id", label: "User ID" },
        { key: "displayName", label: "Name" },
        { key: "email", label: "Email" },
        { key: "role", label: "Role" },
        { key: "authProvider", label: "Auth provider" },
        { key: "createdAt", label: "Created", get: (row) => (row.createdAt ? formatDate(row.createdAt) : "") },
        { key: "lastLogin", label: "Last sign-in", get: (row) => (row.lastLogin ? formatDate(row.lastLogin) : "") },
      ],
    },
    alerts: {
      label: "alerts",
      rows: state.alerts,
      columns: [
        { key: "id", label: "Alert ID" },
        { key: "title", label: "Title" },
        { key: "message", label: "Message" },
        { key: "severity", label: "Severity" },
        { key: "audience", label: "Audience" },
        { key: "recipients", label: "Recipients", get: (row) => alertAudienceLabel(row) },
        { key: "active", label: "Active", get: (row) => (alertIsActive(row) ? "Yes" : "No") },
        { key: "autoPush", label: "Push requested" },
        { key: "createdByName", label: "Created by" },
        { key: "createdAt", label: "Created", get: (row) => (row.createdAt ? formatDate(row.createdAt) : "") },
        { key: "expiresAt", label: "Expires", get: (row) => (row.expiresAt ? formatDate(row.expiresAt) : "") },
        { key: "pushSummary", label: "Push summary" },
      ],
    },
    auditLogs: {
      label: "audit-log",
      rows: state.audit,
      columns: [
        { key: "id", label: "Entry ID" },
        { key: "createdAt", label: "Date", get: (row) => (row.createdAt ? formatDate(row.createdAt) : "") },
        { key: "action", label: "Action" },
        { key: "actorName", label: "Staff" },
        { key: "actorEmail", label: "Staff email" },
        { key: "targetType", label: "Target type" },
        { key: "targetId", label: "Target ID" },
        { key: "details", label: "Details" },
      ],
    },
  };

  const definition = definitions[dataset];
  if (!definition) {
    showToast("That export is not available.", "error");
    return;
  }
  if (!definition.rows.length) {
    showToast(`There is no ${definition.label} data to export yet.`, "info");
    return;
  }

  try {
    if (format === "csv") {
      const csv = toCsv(definition.rows, definition.columns);
      downloadFile(`aide-${definition.label}-${dateStamp}.csv`, `\uFEFF${csv}`, "text/csv;charset=utf-8");
    } else {
      downloadFile(
        `aide-${definition.label}-${dateStamp}.json`,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            generatedBy: { uid: state.user?.uid || "", name: state.displayName },
            dataset: definition.label,
            count: definition.rows.length,
            rows: toPlain(definition.rows),
          },
          null,
          2,
        ),
        "application/json;charset=utf-8",
      );
    }
    void logAudit("export", {
      targetType: "export",
      details: `Exported ${definition.rows.length} ${definition.label} record(s) as ${format.toUpperCase()}`,
    });
    showToast(`${definition.label} exported as ${format.toUpperCase()}.`, "success");
  } catch (error) {
    console.error("[Aide Admin] Export failed.", error);
    showToast("The export could not be created.", "error");
  }
}

function exportFullSnapshot() {
  try {
    downloadFile(
      `aide-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        toPlain({
          generatedAt: new Date().toISOString(),
          generatedBy: { uid: state.user?.uid || "", name: state.displayName },
          appVersion: APP_VERSION,
          counts: {
            users: state.users.length,
            telemetry: state.telemetry.length,
            tickets: state.tickets.length,
            interventions: state.interventions.length,
            alerts: state.alerts.length,
            auditLogs: state.audit.length,
          },
          users: state.users,
          telemetry: state.telemetry,
          tickets: state.tickets,
          interventions: state.interventions,
          alerts: state.alerts,
          auditLogs: state.audit,
        }),
        null,
        2,
      ),
      "application/json;charset=utf-8",
    );
    void logAudit("export", {
      targetType: "export",
      details: `Downloaded a full operational snapshot (${state.tickets.length} tickets, ${state.interventions.length} interventions)`,
    });
    showToast("Full snapshot downloaded.", "success");
  } catch (error) {
    console.error("[Aide Admin] Snapshot export failed.", error);
    showToast("The snapshot could not be created.", "error");
  }
}

async function logAudit(action, { targetType = "", targetId = "", details = "" } = {}) {
  if (!state.user) return;
  try {
    await addDoc(collection(db, "auditLogs"), {
      action,
      actorId: state.user.uid,
      actorName: state.displayName,
      actorEmail: state.user.email || "",
      targetType,
      targetId,
      details: String(details).slice(0, 500),
      createdAt: serverTimestamp(),
      appVersion: APP_VERSION,
    });
  } catch (error) {
    // Auditing must never block the operation being performed.
    console.warn("[Aide Admin] Could not write the audit entry.", error);
  }
}

/* ==========================================================================
   Drawer infrastructure
   ========================================================================== */

function openDrawer({ title = "", subtitle = "", body = "", footer = "", onMount } = {}) {
  closeDrawer();
  const root = qs("#drawerRoot");
  if (!root) return null;

  const previousFocus = document.activeElement;
  root.innerHTML = `<div class="drawer-layer">
    <div class="drawer-backdrop" data-drawer-close></div>
    <aside class="drawer-panel" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <header class="drawer-head">
        <div class="min-w-0">
          <h2 class="drawer-title" id="drawerTitle"></h2>
          <p class="drawer-subtitle"></p>
        </div>
        <button type="button" class="icon-btn" data-drawer-close aria-label="Close panel">${icon("x", "h-5 w-5")}</button>
      </header>
      <div class="drawer-body"></div>
      <footer class="drawer-foot"></footer>
    </aside>
  </div>`;

  const layer = root.querySelector(".drawer-layer");
  layer.querySelector(".drawer-title").textContent = title;
  const subtitleElement = layer.querySelector(".drawer-subtitle");
  subtitleElement.textContent = subtitle;
  subtitleElement.hidden = !subtitle;
  layer.querySelector(".drawer-body").innerHTML = body;
  const footerElement = layer.querySelector(".drawer-foot");
  footerElement.innerHTML = footer;
  footerElement.hidden = !footer;

  const onKey = (event) => {
    if (event.key === "Escape" && !document.getElementById("modalRoot")?.children.length) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key === "Tab") {
      const focusables = qsa(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        layer,
      ).filter((element) => element.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };

  const drawer = {
    root: layer,
    previousFocus,
    onKey,
    close: () => closeDrawer(),
  };
  state.drawer = drawer;
  layer.querySelectorAll("[data-drawer-close]").forEach((element) => element.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", onKey);
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => {
    layer.querySelector("input, textarea, select, button")?.focus?.({ preventScroll: true });
  });
  onMount?.(drawer);
  return drawer;
}

function closeDrawer() {
  const drawer = state.drawer;
  if (!drawer) return;
  state.drawer = null;
  document.removeEventListener("keydown", drawer.onKey);
  const root = qs("#drawerRoot");
  if (root) root.innerHTML = "";
  document.body.style.overflow = "";
  state.activeTicketId = null;
  drawer.previousFocus?.focus?.({ preventScroll: true });
}

/* ==========================================================================
   Actions
   ========================================================================== */

function bindEvents() {
  qs("#adminLoginForm")?.addEventListener("submit", handleLogin);
  qs("#alertForm")?.addEventListener("submit", publishAlert);
  qs("#alertTitle")?.addEventListener("input", debounce(renderAlertPreview, 80));
  qs("#alertMessage")?.addEventListener("input", debounce(renderAlertPreview, 80));
  qs("#alertSeverity")?.addEventListener("change", renderAlertPreview);
  qs("#alertAudience")?.addEventListener("change", renderAlertPreview);
  qs("#audienceSearch")?.addEventListener("input", debounce(renderAudienceList, 100));
  qs("#audienceList")?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-audience-uid]");
    if (!checkbox) return;
    if (checkbox.checked) state.selectedAudience.add(checkbox.dataset.audienceUid);
    else state.selectedAudience.delete(checkbox.dataset.audienceUid);
    setText("#audienceCount", `${state.selectedAudience.size} selected`);
    renderAlertPreview();
  });

  document.addEventListener(
    "click",
    (event) => {
      const nav = event.target.closest("[data-admin-nav]");
      if (nav) {
        event.preventDefault();
        goTo(nav.dataset.adminNav);
        return;
      }

      const action = event.target.closest("[data-admin-action]");
      if (action) {
        event.preventDefault();
        void handleAction(action.dataset.adminAction, action);
        return;
      }

      const alertAction = event.target.closest("[data-alert-action]");
      if (alertAction) {
        event.preventDefault();
        void handleAlertAction(alertAction.dataset.alertAction, alertAction.dataset.alertId, alertAction);
        return;
      }

      const ticket = event.target.closest("[data-admin-ticket]");
      if (ticket) {
        event.preventDefault();
        openTicketDrawer(ticket.dataset.adminTicket);
        return;
      }

      const intervention = event.target.closest("[data-intervention-id]");
      if (intervention) {
        event.preventDefault();
        openInterventionDrawer(intervention.dataset.interventionId);
        return;
      }

      const user = event.target.closest("[data-open-user]");
      if (user) {
        event.preventDefault();
        openUserDrawer(user.dataset.openUser);
      }
    },
    true,
  );

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest("tr[data-admin-ticket], tr[data-intervention-id]");
    if (!row) return;
    event.preventDefault();
    if (row.dataset.adminTicket) openTicketDrawer(row.dataset.adminTicket);
    else if (row.dataset.interventionId) openInterventionDrawer(row.dataset.interventionId);
  });

  window.addEventListener("online", updateNetworkUI);
  window.addEventListener("offline", updateNetworkUI);
}

function bindFilterEvents() {
  if (state.filterEventsBound) return;
  state.filterEventsBound = true;

  qs("#ticketSearch")?.addEventListener("input", debounce(renderTickets, 120));
  ["#ticketStatusFilter", "#ticketCategoryFilter", "#ticketPriorityFilter", "#ticketDateFilter"].forEach((selector) => {
    qs(selector)?.addEventListener("change", renderTickets);
  });

  qs("#interventionSearch")?.addEventListener("input", debounce(renderInterventions, 120));
  ["#interventionFrom", "#interventionTo", "#interventionTechnician"].forEach((selector) => {
    qs(selector)?.addEventListener("change", renderInterventions);
  });
}

async function handleAction(action, button) {
  switch (action) {
    case "sign-out":
      await handleSignOut();
      return;
    case "refresh":
      state.lastUpdated = new Date();
      renderAll();
      state.map?.invalidateSize();
      showToast("Live views refreshed.", "success", 2200);
      return;
    case "account":
      openAccountModal();
      return;
    case "clear-ticket-filters":
      resetTicketFilters();
      return;
    case "clear-intervention-filters":
      resetInterventionFilters();
      return;
    case "new-intervention":
      openNewInterventionModal();
      return;
    case "test-push":
      await sendTestPush(button);
      return;
    case "copy-ticket":
      await copyTicketSummary();
      return;
    case "copy-resolution":
      await copyResolution();
      return;
    case "copy-user-email":
      await copyUserEmail();
      return;
    case "export-tickets-csv":
      exportDataset("tickets", "csv");
      return;
    case "export-tickets-json":
      exportDataset("tickets", "json");
      return;
    case "export-interventions-csv":
      exportDataset("interventions", "csv");
      return;
    case "export-interventions-json":
      exportDataset("interventions", "json");
      return;
    case "export-telemetry-csv":
      exportDataset("telemetry", "csv");
      return;
    case "export-telemetry-json":
      exportDataset("telemetry", "json");
      return;
    case "export-users-csv":
      exportDataset("users", "csv");
      return;
    case "export-users-json":
      exportDataset("users", "json");
      return;
    case "export-alerts-csv":
      exportDataset("alerts", "csv");
      return;
    case "export-alerts-json":
      exportDataset("alerts", "json");
      return;
    case "export-audit-csv":
      exportDataset("auditLogs", "csv");
      return;
    case "export-audit-json":
      exportDataset("auditLogs", "json");
      return;
    case "export-all-json":
      exportFullSnapshot();
      return;
    default:
      console.warn("[Aide Admin] Unknown action.", action);
  }
}

async function handleAlertAction(action, alertId, button) {
  switch (action) {
    case "view":
      openAlertModal(alertId);
      return;
    case "toggle":
      await toggleAlert(alertId, button);
      return;
    case "push":
      await resendAlertPush(alertId, button);
      return;
    case "delete":
      await deleteAlert(alertId, button);
      return;
    default:
      console.warn("[Aide Admin] Unknown alert action.", action);
  }
}

function openAccountModal() {
  const modal = openModal({
    title: state.displayName,
    subtitle: "Administrator session",
    body: detailGrid([
      ["Email", state.user?.email || "No email"],
      ["User ID", state.user?.uid || "Unknown"],
      ["Role", state.profile?.role || "admin"],
      ["Auth provider", state.profile?.authProvider || "password"],
      ["Console version", APP_VERSION],
      ["Last sign-in", state.profile?.lastLogin ? formatDate(state.profile.lastLogin) : "This session"],
    ]),
    footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button>
      <button type="button" class="btn btn-danger" data-account-signout>Sign out</button>`,
    size: "md",
  });
  modal.root.querySelector("[data-account-signout]")?.addEventListener("click", () => {
    modal.close();
    void handleSignOut();
  });
}

async function copyTicketSummary() {
  const ticket = state.tickets.find((item) => item.id === state.activeTicketId);
  if (!ticket) {
    showToast("No ticket is open.", "info");
    return;
  }
  const text = [
    `Ticket #${ticket.id.slice(0, 6).toUpperCase()}`,
    `Subject: ${ticket.subject || "Support request"}`,
    `User: ${ticket.userName || "User"} <${ticket.userEmail || "guest"}>`,
    `Status: ${statusLabel(ticket.status)} · Priority: ${PRIORITY_META[ticket.priority]?.label || ticket.priority || "Normal"}`,
    `Created: ${formatDate(ticket.createdAt)}`,
    `Technician: ${ticket.technicianName || "Unassigned"}`,
    "",
    ticket.description || "No description.",
    "",
    `Resolution: ${ticket.resolution || "Not resolved"}`,
  ].join("\n");
  const ok = await copyText(text);
  showToast(ok ? "Ticket summary copied." : "The summary could not be copied.", ok ? "success" : "error");
}

async function copyResolution() {
  const text = qs("#drawerRoot .drawer-body p.whitespace-pre-wrap")?.textContent?.trim() || "";
  if (!text) {
    showToast("No resolution text is available.", "info");
    return;
  }
  const ok = await copyText(text);
  showToast(ok ? "Resolution copied." : "The resolution could not be copied.", ok ? "success" : "error");
}

async function copyUserEmail() {
  const email = qs("#drawerRoot .drawer-subtitle")?.textContent?.trim() || "";
  if (!email || email === "No email on file") {
    showToast("This user has no email on file.", "info");
    return;
  }
  const ok = await copyText(email);
  showToast(ok ? "Email copied." : "The email could not be copied.", ok ? "success" : "error");
}

function resetTicketFilters() {
  const search = qs("#ticketSearch");
  if (search) search.value = "";
  ["#ticketStatusFilter", "#ticketCategoryFilter", "#ticketPriorityFilter", "#ticketDateFilter"].forEach((selector) => {
    const element = qs(selector);
    if (element) element.value = "all";
  });
  renderTickets();
}

function resetInterventionFilters() {
  const search = qs("#interventionSearch");
  if (search) search.value = "";
  ["#interventionFrom", "#interventionTo"].forEach((selector) => {
    const element = qs(selector);
    if (element) element.value = "";
  });
  const technician = qs("#interventionTechnician");
  if (technician) technician.value = "all";
  renderInterventions();
}

/* ==========================================================================
   Utilities
   ========================================================================== */

function isTelemetryOnline(entry) {
  if (!entry || entry.online === false) return false;
  return isOnline(entry.lastSeenClient || entry.updatedAt, ONLINE_WINDOW_MS);
}

function sortedTelemetry() {
  return [...state.telemetry].sort((a, b) => {
    const onlineDifference = Number(isTelemetryOnline(b)) - Number(isTelemetryOnline(a));
    if (onlineDifference) return onlineDifference;
    return (
      (toDate(b.lastSeenClient || b.updatedAt)?.getTime() || 0) -
      (toDate(a.lastSeenClient || a.updatedAt)?.getTime() || 0)
    );
  });
}

function nameForTelemetry(entry) {
  const user = state.users.find((item) => item.id === entry.id);
  return (
    user?.displayName ||
    entry.name ||
    (entry.email ? entry.email.split("@")[0] : "") ||
    `User ${String(entry.id).slice(-4).toUpperCase()}`
  );
}

function nameForUid(uid) {
  const user = state.users.find((item) => item.id === uid);
  const entry = state.telemetry.find((item) => item.id === uid);
  return user?.displayName || entry?.name || entry?.email || uid;
}

function ticketGuestLabel(uid) {
  const ticket = state.tickets.find((item) => item.userId === uid);
  return Boolean(ticket?.userIsGuest);
}

function categoryLabel(category) {
  return CATEGORY_MAP[category]?.label || "Other";
}

function statusLabel(status) {
  return STATUS_META[status]?.label || status || "Unknown";
}

function priorityBadge(priority) {
  const value = PRIORITY_META[priority] ? priority : "normal";
  const badge = value === "urgent" ? "badge-critical" : value === "high" ? "badge-warning" : value === "low" ? "badge-neutral" : "badge-info";
  return `<span class="badge ${badge}">${escapeHtml(PRIORITY_META[value].label)}</span>`;
}

function detailGrid(items) {
  return `<dl class="context-grid mt-3">${items
    .map(
      ([label, value]) =>
        `<div class="context-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(
          value == null || value === "" ? "—" : String(value),
        )}</dd></div>`,
    )
    .join("")}</dl>`;
}

function contextGrid(context) {
  const device = context.device || {};
  const battery = context.battery || {};
  const gps = context.gps || {};
  const display = context.display || {};
  const time = context.time || {};
  const permissions = context.permissions || {};

  const items = [["Captured", context.capturedAt ? formatDate(context.capturedAt) : "—"]];
  items.push(["Device", `${device.os || "Unknown OS"} · ${device.browser || "Unknown browser"}`]);
  if (device.screenWidth) {
    items.push(["Screen", `${device.screenWidth}×${device.screenHeight} @${device.devicePixelRatio || 1}x`]);
  }
  if (battery.skipped) {
    items.push(["Battery", "Sharing disabled"]);
  } else if (battery.supported) {
    items.push([
      "Battery",
      `${Math.round(Number(battery.percent ?? battery.level * 100) || 0)}%${battery.charging ? " · charging" : ""}`,
    ]);
  } else {
    items.push(["Battery", battery.reason || "Unavailable"]);
  }
  if (gps.skipped) {
    items.push(["Location", "Sharing disabled"]);
  } else if (Number.isFinite(Number(gps.latitude)) && Number.isFinite(Number(gps.longitude))) {
    items.push([
      "Location",
      `${Number(gps.latitude).toFixed(5)}, ${Number(gps.longitude).toFixed(5)}${
        gps.accuracy ? ` · ±${Math.round(gps.accuracy)} m` : ""
      }`,
    ]);
  } else {
    items.push(["Location", gps.error || "Unavailable"]);
  }
  if (display.skipped) {
    items.push(["Display", "Sharing disabled"]);
  } else if (display.brightnessPercent != null) {
    items.push([
      "Display",
      `${display.brightnessPercent}% · ${display.darkMode ? "dark" : "light"} appearance${
        display.lux != null ? ` · ${Math.round(display.lux)} lux` : ""
      }`,
    ]);
  } else {
    items.push(["Display", "Unavailable"]);
  }
  items.push(["Local time", time.localTime ? `${time.localTime} · ${time.utcOffset || ""}` : "—"]);
  items.push(["Timezone", time.timezone || "—"]);
  items.push([
    "Permissions",
    `Location ${permissions.geolocation || "unknown"} · Notifications ${permissions.notifications || "unknown"}`,
  ]);

  return detailGrid(items);
}

function withinDateRange(value, range) {
  if (!range || range === "all") return true;
  const date = toDate(value);
  if (!date) return false;
  const now = new Date();
  if (range === "today") {
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  }
  const days = Number(range);
  if (!Number.isFinite(days)) return true;
  const cutoff = Date.now() - days * 86_400_000;
  return date.getTime() >= cutoff;
}

function resolutionRequired(status) {
  return status === "resolved";
}

function localDateTimeValue(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

function safeHttpUrl(value) {
  const url = String(value || "");
  return /^https?:\/\//i.test(url) ? url : "";
}

function truncate(value, length = 100) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}…` : text;
}

function showInlineError(element, message) {
  if (!element) {
    showToast(message, "error");
    return;
  }
  element.textContent = message;
  element.classList.remove("hidden");
}

function setText(selector, value, root = document) {
  const element = root.querySelector(selector);
  if (element) element.textContent = value;
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("is-loading", busy);
  button.setAttribute("aria-busy", String(busy));
}

function updateNetworkUI() {
  const online = navigator.onLine;
  setText("#adminNetLabel", online ? "Online" : "Offline");
  const dot = qs("#adminNetDot");
  if (dot) {
    dot.style.background = online ? "#34d399" : "#fb7185";
    dot.style.boxShadow = online ? "0 0 0 4px rgba(52,211,153,.14)" : "0 0 0 4px rgba(251,113,133,.14)";
  }
}

function confirmAction(options) {
  return confirmDialog(options);
}

init().catch((error) => {
  console.error("[Aide Admin] Initialization failed.", error);
  hideBoot();
  showAuthScreen("The administration console could not start. Reload the page and try again.");
});
