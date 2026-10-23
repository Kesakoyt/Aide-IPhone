/**
 * Aide iPhone — service worker.
 *
 *  - Pre-caches the application shell for offline starts
 *  - Network-first navigation, stale-while-revalidate for static assets
 *  - Never caches Firebase Auth / Firestore / Functions traffic
 *  - Receives Firebase Cloud Messaging data messages in the background
 *
 * Increase CACHE_VERSION whenever the shell files change so clients receive
 * a clean cache. The app shell itself is versioned by APP_VERSION.
 */

const CACHE_VERSION = "1.1.0";
const CACHE_PREFIX = "aide-iphone";
const SHELL_CACHE = `${CACHE_PREFIX}-shell-v${CACHE_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v${CACHE_VERSION}`;

const FLUENCY_ICONS = [
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
];

const SHELL_FILES = [
  "./",
  "./index.html",
  "./admin.html",
  "./style.css",
  "./tailwind.css",
  "./app.js",
  "./admin.js",
  "./common.js",
  "./firebase-config.js",
  "./tutorials.js",
  "./manifest.json",
  "./icons/favicon-32.png",
  "./icons/favicon-48.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  ...FLUENCY_ICONS.map((name) => `./icons/fluency/${name}.png`),
];

/* --------------------------------------------------------------------------
   Lifecycle
   -------------------------------------------------------------------------- */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // One missing optional asset must not fail the whole installation.
      await Promise.allSettled(SHELL_FILES.map((path) => cache.add(path)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== SHELL_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* --------------------------------------------------------------------------
   Fetch strategies
   -------------------------------------------------------------------------- */

const NETWORK_ONLY_HOSTS = [
  "firebaseapp.com",
  "firebaseio.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "firestore.googleapis.com",
  "cloudfunctions.net",
  "run.app",
  "youtube.com",
  "youtube-nocookie.com",
  "googlevideo.com",
  "accounts.google.com",
];

function isNetworkOnly(url) {
  if (url.protocol !== "http:" && url.protocol !== "https:") return true;
  return NETWORK_ONLY_HOSTS.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`) || url.hostname.includes(host),
  );
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && (response.ok || response.type === "opaque")) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

async function networkFirstNavigation(request) {
  const url = new URL(request.url);
  const shell = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      shell.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await shell.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const fallback = url.pathname.endsWith("/admin.html") ? "./admin.html" : "./index.html";
    const fallbackResponse = await shell.match(fallback);
    if (fallbackResponse) return fallbackResponse;
    return new Response(
      "<!doctype html><meta charset=utf-8><title>Aide iPhone offline</title><body style=\"background:#060913;color:#cbd5e1;font-family:system-ui;padding:2rem\"><h1>Aide iPhone is offline</h1><p>Reconnect once to download the application shell.</p></body>",
      { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (!url.protocol.startsWith("http")) return;
  if (isNetworkOnly(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  // Versioned Firebase SDK modules, Leaflet and fonts are safe to serve from
  // cache first; everything else is revalidated in the background.
  if (
    url.hostname === "www.gstatic.com" ||
    url.hostname === "unpkg.com" ||
    url.hostname === "cdn.tailwindcss.com" ||
    url.hostname === "i.ytimg.com"
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

/* --------------------------------------------------------------------------
   Firebase Cloud Messaging (background)
   -------------------------------------------------------------------------- */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBjGryNQb8d_W9F1Wi638umLv9pdL6cBiw",
  authDomain: "aide-iphone.firebaseapp.com",
  projectId: "aide-iphone",
  storageBucket: "aide-iphone.firebasestorage.app",
  messagingSenderId: "146620382102",
  appId: "1:146620382102:web:9c80876744ab90f8123bb7",
};

try {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js",
  );

  if (firebase.apps.length === 0) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const data = payload.data || {};
    const notification = payload.notification || {};
    const title = notification.title || data.title || "Aide iPhone";
    const body = notification.body || data.body || "You have a new update from the support team.";

    const target = new URL(data.url || "./index.html?view=alerts", self.registration.scope).href;
    const isCritical = data.severity === "critical";

    return self.registration.showNotification(title, {
      body,
      icon: new URL("./icons/icon-192.png", self.registration.scope).href,
      badge: new URL("./icons/icon-192.png", self.registration.scope).href,
      tag: data.tag || data.alertId || data.ticketId || "aide-update",
      renotify: true,
      requireInteraction: isCritical,
      timestamp: Date.now(),
      data: { url: target, alertId: data.alertId || "", ticketId: data.ticketId || "" },
      actions: [{ action: "open", title: "Open Aide" }],
    });
  });
} catch (error) {
  // Offline first loads cannot download the FCM compat scripts. The app shell
  // still works and notifications resume after the next online launch.
  console.info("[Aide SW] Firebase Messaging is unavailable in this context.", error?.message || error);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url
    ? new URL(data.url, self.registration.scope).href
    : new URL("./index.html?view=alerts", self.registration.scope).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const targetUrl = new URL(target);
      for (const client of windows) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== targetUrl.origin) continue;
        await client.focus();
        if (typeof client.navigate === "function") {
          client.navigate(target).catch(() => {});
        }
        client.postMessage({
          type: "AIDE_OPEN_FROM_NOTIFICATION",
          alertId: data.alertId || "",
          ticketId: data.ticketId || "",
          url: target,
        });
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

self.addEventListener("notificationclose", () => {
  // Reserved for future delivery analytics.
});
