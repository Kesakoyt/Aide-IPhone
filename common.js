/**
 * Shared UI helpers and domain metadata.
 * Deliberately dependency-free so both the client and the admin panel can use it.
 */

export const APP_NAME = "Aide iPhone";

export const CATEGORIES = [
  { id: "account", label: "Account & sign-in", icon: "lock", description: "Passwords, Apple Account, verification" },
  { id: "connectivity", label: "Wi-Fi & network", icon: "wifi", description: "Wi-Fi, cellular, hotspot, VPN" },
  { id: "battery", label: "Battery & charging", icon: "battery", description: "Drain, charging, overheating" },
  { id: "apps", label: "Apps & storage", icon: "smartphone", description: "Installs, updates, free space" },
  { id: "security", label: "Security & privacy", icon: "shield", description: "Suspicious activity, permissions" },
  { id: "hardware", label: "Hardware & screen", icon: "tool", description: "Display, buttons, camera, sound" },
  { id: "other", label: "Something else", icon: "help", description: "Anything not covered above" },
];

export const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map((item) => [item.id, item]));

export const STATUS_META = {
  pending: { label: "Pending", badge: "badge-pending", description: "Waiting for a technician" },
  in_progress: { label: "In progress", badge: "badge-progress", description: "A technician is working on it" },
  resolved: { label: "Resolved", badge: "badge-resolved", description: "Closed with a solution" },
};

export const SEVERITY_META = {
  info: { label: "Information", badge: "badge-info", icon: "info" },
  warning: { label: "Important", badge: "badge-warning", icon: "alert-triangle" },
  critical: { label: "Critical", badge: "badge-critical", icon: "alert-circle" },
};

export const PRIORITY_META = {
  low: { label: "Low" },
  normal: { label: "Normal" },
  high: { label: "High" },
  urgent: { label: "Urgent" },
};

/**
 * Supported Icons8 Fluency icons. Each name maps to icons/fluency/<name>.png.
 * Source: https://icons8.com/icons/set/fluency (free license with attribution).
 * Add a name here and run scripts/download-icons.ps1 before using a new icon.
 */
const ICONS = new Set([
  "activity",
  "alert-circle",
  "alert-triangle",
  "arrow-right",
  "battery",
  "bell",
  "book-open",
  "camera",
  "check",
  "check-circle",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "clock",
  "copy",
  "dashboard",
  "database",
  "download",
  "external-link",
  "eye",
  "file-text",
  "filter",
  "gauge",
  "globe",
  "help",
  "home",
  "info",
  "life-buoy",
  "lock",
  "log-out",
  "mail",
  "map",
  "map-pin",
  "megaphone",
  "message-square",
  "moon",
  "navigation",
  "paperclip",
  "play",
  "plus",
  "refresh",
  "rotate-ccw",
  "search",
  "send",
  "settings",
  "shield",
  "signal",
  "smartphone",
  "sparkles",
  "sun",
  "ticket",
  "tool",
  "trash",
  "user",
  "users",
  "volume",
  "wifi",
  "wifi-off",
  "x",
]);

/**
 * Renders an Icons8 Fluency raster icon. The name is checked against the fixed
 * set above, so callers cannot inject arbitrary markup or URLs.
 */
export function icon(name, className = "h-5 w-5") {
  const key = ICONS.has(name) ? name : "help";
  return `<img src="./icons/fluency/${key}.png" class="${className} fluency-icon" alt="" aria-hidden="true" draggable="false" />`;
}

export function qs(selector, root = document) {
  return root.querySelector(selector);
}

export function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Converts Firestore Timestamps/Date/number/string into a JavaScript Date (or null). */
export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function formatDate(value, options = {}) {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...options,
  }).format(date);
}

export function formatDay(value) {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

export function formatTime(value) {
  const date = toDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(date);
}

export function timeAgo(value) {
  const date = toDate(value);
  if (!date) return "never";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size || unit === "second") {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return "just now";
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function formatPercent(ratioOrPercent) {
  if (!Number.isFinite(ratioOrPercent)) return "—";
  const percent = ratioOrPercent <= 1 ? ratioOrPercent * 100 : ratioOrPercent;
  return `${Math.round(percent)}%`;
}

export function getInitials(nameOrEmail = "", fallback = "A") {
  const source = String(nameOrEmail).trim();
  if (!source) return fallback;
  const parts = source.includes("@") ? [source.split("@")[0]] : source.split(/\s+/);
  const letters = parts.filter(Boolean).slice(0, 2).map((part) => part[0]);
  return (letters.join("") || fallback).toUpperCase();
}

export function displayNameFor(user, profile) {
  return (
    profile?.displayName ||
    user?.displayName ||
    (user?.email ? user.email.split("@")[0] : "") ||
    (user?.isAnonymous ? "Guest user" : "User")
  );
}

/** Parses enough of the user agent for support diagnostics. */
export function parseUserAgent(userAgent = navigator.userAgent) {
  const ua = String(userAgent);
  let os = "Unknown OS";
  let deviceType = "desktop";
  if (/iPhone/i.test(ua)) {
    os = "iOS";
    deviceType = "iPhone";
  } else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    os = "iPadOS";
    deviceType = "iPad";
  } else if (/Android/i.test(ua)) {
    os = "Android";
    deviceType = /Mobile/i.test(ua) ? "phone" : "tablet";
  } else if (/Windows/i.test(ua)) {
    os = "Windows";
  } else if (/Mac OS X|Macintosh/i.test(ua)) {
    os = "macOS";
  } else if (/CrOS/i.test(ua)) {
    os = "ChromeOS";
  } else if (/Linux/i.test(ua)) {
    os = "Linux";
  }

  let browser = "Unknown browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/CriOS\//i.test(ua)) browser = "Chrome iOS";
  else if (/FxiOS\//i.test(ua)) browser = "Firefox iOS";
  else if (/Chrome\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  else if (/SamsungBrowser/i.test(ua)) browser = "Samsung Internet";

  const versionMatch = ua.match(/(?:Version|Chrome|CriOS|Firefox|FxiOS|Edg|OPR)\/([\d.]+)/);
  return {
    os,
    browser,
    browserVersion: versionMatch ? versionMatch[1].split(".")[0] : "",
    deviceType,
    userAgent: ua,
  };
}

export function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.navigator.standalone === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches
  );
}

export function humanizeCategory(id) {
  return CATEGORY_MAP[id]?.label || id || "Other";
}

export function friendlyAuthError(error) {
  const code = error?.code || "";
  const map = {
    "auth/invalid-email": "That email address does not look valid.",
    "auth/missing-password": "Please enter your password.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/email-already-in-use": "An account already exists with this email.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "No account found with this email.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/operation-not-allowed": "This sign-in method is not enabled in Firebase.",
    "auth/requires-recent-login": "Please sign out and sign in again to continue.",
    "auth/credential-already-in-use": "That email is already linked to another account.",
    "auth/provider-already-linked": "This account already has an email sign-in method.",
    "auth/user-disabled": "This account has been disabled.",
    "permission-denied": "You do not have permission to perform this action.",
    "unavailable": "The service is temporarily unavailable. Check your connection.",
    "functions/not-found": "The push service is not deployed yet.",
    "functions/internal": "The push service encountered an error.",
  };
  return map[code] || error?.message?.replace(/^Firebase:\s*/i, "") || "Something went wrong. Please try again.";
}

export function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  // Fallback for insecure contexts. The result is only used as a Firestore doc id.
  let hash = 0;
  for (const byte of data) hash = (hash * 31 + byte) >>> 0;
  return `fallback-${hash.toString(16)}-${data.length}`;
}

export function safeFileName(name) {
  return String(name || "file")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(-120);
}

/** Recursively converts Firestore Timestamps into ISO strings for export. */
export function toPlain(value) {
  if (value == null) return value;
  if (typeof value?.toDate === "function") {
    try {
      return value.toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toPlain(item)]));
  }
  return value;
}

function sheetCell(value) {
  let output = "";
  if (value == null) output = "";
  else if (typeof value === "object") output = JSON.stringify(toPlain(value));
  else output = String(value);
  // Mitigate CSV formula injection when the file is opened in a spreadsheet.
  if (/^[=+\-@\t\r]/.test(output)) output = `'${output}`;
  return `"${output.replaceAll('"', '""')}"`;
}

/**
 * Builds RFC 4180 compliant CSV.
 * @param {Array<object>} rows
 * @param {Array<{key: string, label: string, get?: (row: object) => unknown}>} columns
 */
export function toCsv(rows, columns) {
  const header = columns.map((column) => sheetCell(column.label)).join(",");
  const body = rows.map((row) =>
    columns
      .map((column) => sheetCell(column.get ? column.get(row) : row[column.key]))
      .join(","),
  );
  return [header, ...body].join("\r\n");
}

export function downloadFile(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Toast notifications, available on every screen. */
export function showToast(message, type = "info", duration = 4800) {
  let root = document.getElementById("toastRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "toastRoot";
    root.className = "toast-root";
    root.setAttribute("aria-live", "polite");
    document.body.appendChild(root);
  }
  const iconName = { success: "check-circle", error: "alert-circle", warning: "alert-triangle" }[type] || "info";
  const element = document.createElement("div");
  element.className = `toast toast-${type}`;
  element.setAttribute("role", type === "error" ? "alert" : "status");
  const iconSpan = document.createElement("span");
  iconSpan.className = "toast-icon";
  iconSpan.innerHTML = icon(iconName, "h-5 w-5");
  const text = document.createElement("p");
  text.className = "toast-message";
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss notification");
  close.innerHTML = icon("x", "h-4 w-4");
  close.addEventListener("click", () => dismiss());
  element.append(iconSpan, text, close);
  root.appendChild(element);

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    element.classList.add("toast-out");
    setTimeout(() => element.remove(), 220);
  };
  timer = setTimeout(dismiss, Math.max(1500, duration));
  element.addEventListener("mouseenter", () => clearTimeout(timer));
  element.addEventListener("mouseleave", () => {
    timer = setTimeout(dismiss, 1800);
  });
  return dismiss;
}

/** A small accessible modal used by both applications. */
export function openModal({ title = "", subtitle = "", body = "", footer = "", size = "md", onClose } = {}) {
  const root = document.getElementById("modalRoot");
  if (!root) throw new Error("modalRoot is missing");
  const previousFocus = document.activeElement;
  root.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.className = "modal-layer";
  wrapper.innerHTML = `
    <div class="modal-backdrop" data-modal-close></div>
    <section class="modal-panel modal-${size}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <header class="modal-head">
        <div>
          <h2 id="modalTitle" class="modal-title"></h2>
          <p class="modal-subtitle"></p>
        </div>
        <button type="button" class="icon-btn" data-modal-close aria-label="Close dialog">${icon("x", "h-5 w-5")}</button>
      </header>
      <div class="modal-body"></div>
      <footer class="modal-foot"></footer>
    </section>`;
  root.appendChild(wrapper);
  wrapper.querySelector(".modal-title").textContent = title;
  wrapper.querySelector(".modal-subtitle").textContent = subtitle;
  wrapper.querySelector(".modal-subtitle").hidden = !subtitle;
  wrapper.querySelector(".modal-body").innerHTML = body;
  const foot = wrapper.querySelector(".modal-foot");
  foot.innerHTML = footer;
  if (!footer) foot.hidden = true;

  const close = () => {
    document.removeEventListener("keydown", onKey);
    root.innerHTML = "";
    previousFocus?.focus?.({ preventScroll: true });
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      const focusables = qsa(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        wrapper,
      ).filter((el) => el.offsetParent !== null);
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
  qsa("[data-modal-close]", wrapper).forEach((element) => element.addEventListener("click", close));
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(() => wrapper.querySelector(".modal-close, .modal-body button, .modal-body input, [data-modal-close]")?.focus?.());
  return { close, root: wrapper };
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const modal = openModal({
      title,
      body: `<p class="text-sm leading-6 text-slate-300">${escapeHtml(message)}</p>`,
      footer: `<button type="button" class="btn btn-secondary" data-cancel>Cancel</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${escapeHtml(confirmLabel)}</button>`,
      size: "sm",
      onClose: () => resolve(false),
    });
    modal.root.querySelector("[data-cancel]").addEventListener("click", () => {
      modal.close();
      resolve(false);
    });
    modal.root.querySelector("[data-confirm]").addEventListener("click", () => {
      modal.close();
      resolve(true);
    });
  });
}

/** Renders the shared status badge markup. */
export function statusBadge(status) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  return `<span class="badge ${meta.badge}"><span class="badge-dot"></span>${escapeHtml(meta.label)}</span>`;
}

export function severityBadge(severity) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.info;
  return `<span class="badge ${meta.badge}">${escapeHtml(meta.label)}</span>`;
}

export function categoryLabel(id) {
  return CATEGORY_MAP[id]?.label || "Other";
}

export function localTimeInZone(timeZone) {
  if (!timeZone) return null;
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date());
  } catch {
    return null;
  }
}

export function isOnline(lastSeen, windowMs = 5 * 60_000) {
  const date = toDate(lastSeen);
  return Boolean(date && Date.now() - date.getTime() < windowMs);
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns the correct view name for a URL query parameter. */
export function viewFromQuery(allowed) {
  const view = new URLSearchParams(location.search).get("view");
  return allowed.includes(view) ? view : null;
}
