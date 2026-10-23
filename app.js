/**
 * Aide iPhone — client PWA.
 *
 * Responsibilities:
 *  - Email/password + anonymous authentication (with guest → account upgrade)
 *  - Periodic device telemetry written to Firestore
 *  - Real-time alerts, tickets and status tracking
 *  - File attachments in Firebase Storage
 *  - FCM token registration and foreground notifications
 *  - Offline-friendly PWA lifecycle
 */
import {
  auth,
  db,
  storage,
  APP_VERSION,
  TELEMETRY_INTERVAL_MS,
  VAPID_PUBLIC_KEY,
  getMessagingClient,
} from "./firebase-config.js";
import {
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  updateProfile,
  sendPasswordResetEmail,
  EmailAuthProvider,
  linkWithCredential,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  onSnapshot,
  limit,
  serverTimestamp,
  deleteDoc,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getToken, onMessage, deleteToken } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import {
  CATEGORIES,
  CATEGORY_MAP,
  SEVERITY_META,
  STATUS_META,
  clamp,
  copyText,
  debounce,
  displayNameFor,
  escapeHtml,
  formatBytes,
  formatDate,
  friendlyAuthError,
  getInitials,
  icon,
  isStandalone,
  openModal,
  parseUserAgent,
  qs,
  qsa,
  safeFileName,
  sha256Hex,
  showToast,
  statusBadge,
  timeAgo,
  toDate,
  viewFromQuery,
  wait,
} from "./common.js";
import { FAQS, GUIDES, GUIDE_CATEGORIES, VIDEOS } from "./tutorials.js";

/* ==========================================================================
   Constants and application state
   ========================================================================== */

const VIEWS = ["home", "support", "guides", "alerts", "profile"];
const MAX_FILES = 3;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const SEEN_ALERTS_KEY = "aide.seenAlerts.v1";
const TELEMETRY_PREF_KEY = "aide.telemetry.enabled";
const DEVICE_INFO = parseUserAgent();
const IS_IOS = /iOS|iPadOS/.test(DEVICE_INFO.os);

const state = {
  user: null,
  profile: null,
  displayName: "",
  appReady: false,
  authInitialized: false,
  currentView: "home",
  pendingView: viewFromQuery(VIEWS),
  pendingAlertId: queryParam("alert"),
  pendingTicketId: queryParam("ticket"),
  telemetryEnabled: readStoredBoolean(TELEMETRY_PREF_KEY, true),
  telemetryTimer: null,
  telemetryBusy: false,
  lastContext: null,
  lastSyncAt: null,
  syncFailed: false,
  syncError: "",
  lastLocation: null,
  batteryManager: null,
  batteryListenersAttached: false,
  ambientSensor: null,
  ambientLux: null,
  alerts: [],
  alertsUnsub: null,
  alertQueue: [],
  currentAlert: null,
  seenAlerts: readSeenAlerts(),
  tickets: [],
  ticketsUnsub: null,
  ticketsReady: false,
  ticketStatuses: new Map(),
  ticketFilter: "all",
  ticketFiles: [],
  guideQuery: "",
  guideCategory: "all",
  installPrompt: null,
  swRegistration: null,
  messaging: null,
  messageUnsub: null,
  fcmToken: null,
  definition: null,
};

/** Reads a trimmed query-string value without throwing on unusual URLs. */
function queryParam(name) {
  try {
    return new URLSearchParams(location.search).get(name)?.trim() || null;
  } catch {
    return null;
  }
}

/** Removes a consumed deep-link parameter while preserving the rest of the URL. */
function clearQueryParam(name) {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* History may be unavailable in embedded or file contexts. */
  }
}

/* ==========================================================================
   Bootstrap and authentication
   ========================================================================== */

async function init() {
  qsa("[data-app-version]").forEach((node) => {
    node.textContent = APP_VERSION;
  });
  bindStaticEvents();
  updateNetworkUI();
  updateGreeting();
  renderCategoryOptions();
  renderGuides();
  renderFaqs();
  renderVideos();
  setAuthMode("login");
  renderTelemetryToggles();
  updateInstallUI();
  refreshPushUI();
  renderPermissionChips();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    updateInstallUI();
  });
  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    updateInstallUI();
    showToast("Aide was installed on this device.", "success");
  });

  registerServiceWorker().catch((error) => console.warn("[Aide] Service worker registration failed.", error));

  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (error) {
    console.warn("[Aide] Could not set auth persistence.", error);
  }

  onAuthStateChanged(auth, (user) => {
    handleAuthUser(user).catch((error) => {
      console.error("[Aide] Auth handling failed.", error);
      showToast("We could not load your profile. Please try again.", "error");
      hideBoot();
    });
  });
}

async function handleAuthUser(user) {
  state.authInitialized = true;

  if (!user) {
    teardownSession();
    showAuthScreen();
    hideBoot();
    return;
  }

  // Linking a guest account or refreshing a token can emit the same user again.
  if (state.user?.uid === user.uid && state.appReady) {
    state.user = user;
    state.displayName = displayNameFor(user, state.profile);
    renderProfile();
    return;
  }

  teardownSession();
  state.user = user;
  state.displayName = displayNameFor(user, null);
  hideAuthScreen();
  showAppShell();
  hideBoot();

  const profile = await ensureUserProfile(user);
  state.profile = profile;
  state.displayName = displayNameFor(user, profile);
  state.appReady = true;

  updateGreeting();
  renderProfile();
  const targetView = state.pendingView || "home";
  state.pendingView = null;
  goTo(targetView, { scroll: false });

  startAlerts();
  startTickets();
  startTelemetry();
  refreshPushUI();
  refreshPermissionChips();
  refreshInstallVisibility();

  // If permission was granted in a previous session, silently refresh the token.
  if (VAPID_PUBLIC_KEY && "Notification" in window && Notification.permission === "granted") {
    setTimeout(() => enablePush({ silent: true }), 1500);
  }
}

async function ensureUserProfile(user) {
  const profileRef = doc(db, "users", user.uid);
  const fallbackName =
    user.displayName || (user.email ? user.email.split("@")[0] : `Guest ${user.uid.slice(-4).toUpperCase()}`);
  try {
    const snapshot = await getDoc(profileRef);
    if (!snapshot.exists()) {
      const provider = user.providerData[0]?.providerId || (user.isAnonymous ? "anonymous" : "password");
      const data = {
        uid: user.uid,
        email: user.email || "",
        displayName: fallbackName,
        role: "user",
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        authProvider: provider,
        photoURL: user.photoURL || "",
        phone: user.phoneNumber || "",
      };
      await setDoc(profileRef, data);
      return { ...data, role: "user" };
    }

    const existing = snapshot.data();
    const updates = { lastLogin: serverTimestamp() };
    if (user.displayName && user.displayName !== existing.displayName) {
      updates.displayName = user.displayName;
    }
    const provider = user.providerData[0]?.providerId || (user.isAnonymous ? "anonymous" : "password");
    if (provider !== existing.authProvider) updates.authProvider = provider;
    await updateDoc(profileRef, updates).catch((error) => {
      // A rules/offline failure should not block the app shell.
      console.warn("[Aide] Could not update profile metadata.", error);
    });
    return { ...existing, ...updates, displayName: updates.displayName || existing.displayName || fallbackName };
  } catch (error) {
    console.error("[Aide] Profile load failed.", error);
    showToast("Profile sync is unavailable. Some actions may fail until it recovers.", "warning", 6000);
    return {
      uid: user.uid,
      email: user.email || "",
      displayName: fallbackName,
      role: "user",
      authProvider: user.isAnonymous ? "anonymous" : "password",
      createdAt: null,
      lastLogin: null,
    };
  }
}

function showAuthScreen() {
  state.appReady = false;
  qs("#authScreen")?.classList.remove("hidden");
  qs("#appShell")?.classList.add("hidden");
  const submit = qs("#authSubmit");
  if (submit) {
    submit.classList.remove("is-loading");
    submit.disabled = false;
  }
  hideFormError("#authError");
}

function showAppShell() {
  qs("#authScreen")?.classList.add("hidden");
  qs("#appShell")?.classList.remove("hidden");
}

function hideAuthScreen() {
  qs("#authScreen")?.classList.add("hidden");
}

function hideBoot() {
  const boot = qs("#bootScreen");
  if (!boot) return;
  boot.classList.add("is-done");
  setTimeout(() => boot.setAttribute("aria-hidden", "true"), 400);
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  const isRegister = state.authMode === "register";
  qsa("[data-auth-mode]").forEach((button) => {
    const active = button.dataset.authMode === state.authMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  setText("#authTitle", isRegister ? "Create your account" : "Welcome back");
  setText(
    "#authSubtitle",
    isRegister ? "Keep your tickets and device history in one place." : "Sign in to see your tickets and device status.",
  );
  qs("#authNameField")?.classList.toggle("hidden", !isRegister);
  const submit = qs("#authSubmit");
  if (submit) submit.textContent = isRegister ? "Create account" : "Sign in";
  const password = qs("#authPassword");
  if (password) password.setAttribute("autocomplete", isRegister ? "new-password" : "current-password");
  hideFormError("#authError");
}

async function submitAuthForm(event) {
  event.preventDefault();
  const mode = state.authMode;
  const email = qs("#authEmail")?.value.trim() || "";
  const password = qs("#authPassword")?.value || "";
  const name = qs("#authName")?.value.trim() || "";
  const submit = qs("#authSubmit");

  hideFormError("#authError");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFormError("#authError", "Enter a valid email address.");
    qs("#authEmail")?.focus();
    return;
  }
  if (password.length < 6) {
    showFormError("#authError", "Your password must be at least 6 characters.");
    qs("#authPassword")?.focus();
    return;
  }

  setBusy(submit, true);
  try {
    if (mode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) {
        await updateProfile(credential.user, { displayName: name }).catch(() => {});
        await updateDoc(doc(db, "users", credential.user.uid), { displayName: name }).catch(() => {});
        state.displayName = name;
        if (state.profile) state.profile.displayName = name;
        updateGreeting();
        renderProfile();
      }
      showToast("Your account is ready.", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    console.warn("[Aide] Sign-in failed.", error);
    showFormError("#authError", friendlyAuthError(error));
  } finally {
    setBusy(submit, false);
  }
}

async function continueAsGuest() {
  hideFormError("#authError");
  const guestButton = qs("#guestBtn");
  setBusy(guestButton, true);
  try {
    await signInAnonymously(auth);
    showToast("Signed in as a guest. You can add an email later.", "info");
  } catch (error) {
    console.warn("[Aide] Anonymous sign-in failed.", error);
    showFormError("#authError", friendlyAuthError(error));
  } finally {
    setBusy(guestButton, false);
  }
}

async function resetPassword() {
  const email = qs("#authEmail")?.value.trim() || "";
  if (!email) {
    showFormError("#authError", "Enter your email address first, then tap “Forgot password?” again.");
    qs("#authEmail")?.focus();
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast(`Password reset email sent to ${email}.`, "success", 6500);
  } catch (error) {
    showFormError("#authError", friendlyAuthError(error));
  }
}

async function upgradeGuestAccount(event) {
  event.preventDefault();
  if (!state.user?.isAnonymous) return;
  const email = qs("#upgradeEmail")?.value.trim() || "";
  const password = qs("#upgradePassword")?.value || "";
  const name = qs("#upgradeName")?.value.trim() || "";
  const button = qs("#upgradeBtn");

  hideFormError("#upgradeError");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showFormError("#upgradeError", "Enter a valid email address.");
    return;
  }
  if (password.length < 6) {
    showFormError("#upgradeError", "Choose a password with at least 6 characters.");
    return;
  }

  setBusy(button, true);
  try {
    const credential = EmailAuthProvider.credential(email, password);
    const result = await linkWithCredential(state.user, credential);
    if (name) await updateProfile(result.user, { displayName: name });
    await updateDoc(doc(db, "users", result.user.uid), {
      email: result.user.email || email,
      displayName: name || state.profile?.displayName || state.displayName,
      authProvider: "password",
    });
    state.user = result.user;
    if (state.profile) {
      state.profile.email = result.user.email || email;
      state.profile.authProvider = "password";
      if (name) state.profile.displayName = name;
    }
    state.displayName = displayNameFor(result.user, state.profile);
    renderProfile();
    updateGreeting();
    showToast("Account linked. Your guest history is now recoverable.", "success", 6500);
  } catch (error) {
    console.warn("[Aide] Guest upgrade failed.", error);
    let message = friendlyAuthError(error);
    if (error?.code === "auth/credential-already-in-use" || error?.code === "auth/email-already-in-use") {
      message =
        "That email already has an account. Sign out and sign in with it instead — your guest tickets stay on this device.";
    }
    showFormError("#upgradeError", message);
  } finally {
    setBusy(button, false);
  }
}

async function handleSignOut() {
  const confirmed = await confirmDialog({
    title: "Sign out of Aide?",
    message: "You can sign back in at any time. Guest sessions cannot be recovered after signing out.",
    confirmLabel: "Sign out",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await cleanupPushToken();
    await signOut(auth);
    showToast("Signed out.", "info");
  } catch (error) {
    console.error("[Aide] Sign out failed.", error);
    showToast("Could not sign out. Please try again.", "error");
  }
}

/* ==========================================================================
   Navigation
   ========================================================================== */

function goTo(view, { scroll = true } = {}) {
  if (!VIEWS.includes(view)) view = "home";
  if (!state.user) return;
  state.currentView = view;
  qsa("[data-view]").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.view !== view);
  });
  qsa("[data-nav]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.nav === view);
  });
  if (view === "profile") renderProfile();
  if (view === "alerts") renderAlerts();
  if (view === "support") {
    renderTickets();
    renderTicketContextPreview();
  }
  if (view === "home") {
    renderHomeTickets();
    updateGreeting();
  }
  if (view === "guides") renderGuides();
  if (scroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ==========================================================================
   Service worker, install prompt, and push notifications
   ========================================================================== */

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setSwStatus("Service workers are not supported in this browser.");
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
      updateViaCache: "none",
    });
    state.swRegistration = registration;
    setSwStatus("Registering offline cache…");
    await navigator.serviceWorker.ready;
    setSwStatus("Active · offline cache ready");
    if (registration.waiting && navigator.serviceWorker.controller) {
      showToast("An app update is ready. It will apply the next time you reopen Aide.", "info", 7000);
    }
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          showToast("A new version of Aide is ready. Reopen the app to update.", "info", 7000);
        }
      });
    });
    return registration;
  } catch (error) {
    console.warn("[Aide] Service worker failed.", error);
    setSwStatus("Offline cache unavailable");
    return null;
  }
}

function setSwStatus(text) {
  const node = qs("#swStatus");
  if (node) node.textContent = text;
}

function updateInstallUI() {
  const standalone = isStandalone();
  const canPrompt = Boolean(state.installPrompt);
  const showBanner = !standalone && (canPrompt || IS_IOS);
  qs("#installBanner")?.classList.toggle("hidden", !showBanner);
  const status = qs("#installStatusText");
  if (status) {
    status.textContent = standalone
      ? "Aide is installed. You are running the standalone app."
      : canPrompt
        ? "Your browser can install Aide. It will open in its own window."
        : IS_IOS
          ? "On iPhone, open this page in Safari, tap Share, then “Add to Home Screen”."
          : "Use your browser menu and choose “Install app” or “Add to Home screen”.";
  }
}

function refreshInstallVisibility() {
  updateInstallUI();
}

async function installApp() {
  if (isStandalone()) {
    showToast("Aide is already installed on this device.", "info");
    return;
  }
  if (state.installPrompt) {
    const prompt = state.installPrompt;
    state.installPrompt = null;
    prompt.prompt();
    const choice = await prompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
      showToast("Installing Aide…", "success");
    } else {
      showToast("Installation dismissed. You can try again from your profile.", "info");
    }
    updateInstallUI();
    return;
  }
  showInstallInstructions();
}

function showInstallInstructions() {
  const body = IS_IOS
    ? `<ol class="space-y-3 text-sm leading-6 text-slate-300">
         <li><strong class="text-white">1.</strong> Open Aide in <strong>Safari</strong>.</li>
         <li><strong class="text-white">2.</strong> Tap the <strong>Share</strong> button in the toolbar.</li>
         <li><strong class="text-white">3.</strong> Scroll down and tap <strong>Add to Home Screen</strong>.</li>
         <li><strong class="text-white">4.</strong> Confirm with <strong>Add</strong>, then open Aide from your Home Screen.</li>
       </ol>
       <div class="alert-banner info mt-4">
         <div class="alert-banner-icon">${icon("info", "h-4 w-4")}</div>
         <div><h3>Using another browser?</h3><p>Only Safari can install a Home Screen web app on iPhone and iPad.</p></div>
       </div>`
    : `<p class="text-sm leading-6 text-slate-300">
         Open your browser menu and choose <strong>Install app</strong>, <strong>Install Aide</strong> or
         <strong>Add to Home screen</strong>. The exact wording depends on your browser.
       </p>
       <p class="mt-3 text-sm leading-6 text-slate-400">
         If the option is missing, make sure you are on the published HTTPS address and have visited the app at least once.
       </p>`;
  openModal({
    title: "Install Aide iPhone",
    subtitle: "Full screen, home-screen icon and reliable push notifications",
    body,
    footer: `<button type="button" class="btn btn-primary" data-modal-close>Got it</button>`,
    size: "md",
  });
}

function refreshPushUI() {
  const supported = "Notification" in window && "serviceWorker" in navigator;
  const permission = supported ? Notification.permission : "unsupported";
  const configured = Boolean(VAPID_PUBLIC_KEY);

  const permissionBadge = qs("#pushStatusBadge");
  const permissionText = qs("#pushStatusText");
  if (permissionBadge) {
    const labels = {
      granted: "Enabled",
      denied: "Blocked",
      default: "Not asked",
      unsupported: "Unsupported",
    };
    permissionBadge.textContent = labels[permission] || "Unknown";
    permissionBadge.className = `badge js-push-status ${
      permission === "granted" ? "badge-resolved" : permission === "denied" ? "badge-critical" : "badge-neutral"
    }`;
  }
  if (permissionText) {
    permissionText.textContent =
      permission === "granted"
        ? "Browser permission is granted. Aide can send ticket updates and urgent alerts."
        : permission === "denied"
          ? IS_IOS
            ? "Notifications are blocked. Open iOS Settings → Notifications → Aide (or Safari) to allow them."
            : "Notifications are blocked. Use your browser site settings to allow them, then reload Aide."
          : permission === "unsupported"
            ? IS_IOS
              ? "Install Aide to your Home Screen on iOS 16.4 or later to enable web push."
              : "This browser does not support web push notifications."
            : "Aide has not asked for notification permission yet.";
  }

  const configBadge = qs("#pushConfigBadge");
  const configText = qs("#pushConfigStatus");
  if (configBadge) {
    configBadge.textContent = configured ? "Configured" : "Not configured";
    configBadge.className = `badge ${configured ? "badge-resolved" : "badge-warning"}`;
  }
  if (configText) {
    configText.textContent = configured
      ? "Firebase Cloud Messaging is ready. The Cloud Function delivers alerts to registered devices."
      : "Add your Web Push VAPID public key to firebase-config.js, then deploy the Cloud Functions to enable push delivery.";
  }

  const showHomeBanner = supported && configured && permission === "default" && Boolean(state.user);
  qs("#homePushBanner")?.classList.toggle("hidden", !showHomeBanner);
  const hint = qs("#homePushHint");
  if (hint) {
    hint.textContent =
      permission === "granted"
        ? "Push is active on this device."
        : permission === "denied"
          ? "Blocked in browser settings."
          : configured
            ? "Enable important alerts."
            : "Push is not configured yet.";
  }
}

async function enablePush({ silent = false } = {}) {
  if (!state.user) return null;
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    if (!silent) showToast("This browser does not support push notifications.", "warning");
    return null;
  }
  if (!VAPID_PUBLIC_KEY) {
    if (!silent) {
      showToast(
        "Push is not configured yet. Add the VAPID public key in firebase-config.js and deploy the functions.",
        "warning",
        8500,
      );
    }
    refreshPushUI();
    return null;
  }

  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") {
      if (!silent) {
        showToast(
          permission === "denied"
            ? "Notifications are blocked. Allow them in your browser or iOS settings, then try again."
            : "Notification permission was not granted.",
          "warning",
          6500,
        );
      }
      refreshPushUI();
      return null;
    }

    const messaging = state.messaging || (await getMessagingClient());
    if (!messaging) {
      if (!silent) showToast("Firebase Messaging is not available in this browser.", "warning");
      return null;
    }
    state.messaging = messaging;
    attachForegroundMessageHandler(messaging);

    const registration =
      state.swRegistration ||
      (await withTimeout(navigator.serviceWorker.ready, 12000, null).catch(() => null));
    if (!registration) throw new Error("The service worker is not ready.");

    const token = await getToken(messaging, {
      vapidKey: VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) throw new Error("Firebase did not return a registration token.");

    await storeFcmToken(token);
    state.fcmToken = token;
    refreshPushUI();
    if (!silent) showToast("Push notifications are enabled on this device.", "success");
    return token;
  } catch (error) {
    console.error("[Aide] Push registration failed.", error);
    if (!silent) {
      const reason =
        error?.code === "messaging/permission-blocked"
          ? "Notifications are blocked for this site."
          : error?.message || "Push registration failed.";
      showToast(`${reason} Check the VAPID key and service worker setup.`, "error", 8000);
    }
    return null;
  }
}

function attachForegroundMessageHandler(messaging) {
  if (state.messageUnsub) return;
  state.messageUnsub = onMessage(messaging, (payload) => {
    const title = payload.notification?.title || payload.data?.title || "Aide iPhone";
    const body = payload.notification?.body || payload.data?.body || "You have a new update.";
    showToast(`${title} — ${body}`, "info", 8500);
  });
}

async function storeFcmToken(token) {
  if (!state.user) return;
  const tokenId = await sha256Hex(token);
  await setDoc(
    doc(db, "fcmTokens", tokenId),
    {
      uid: state.user.uid,
      email: state.user.email || "",
      token,
      active: true,
      platform: `${DEVICE_INFO.os} · ${DEVICE_INFO.browser}`,
      userAgent: navigator.userAgent,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

async function cleanupPushToken() {
  const token = state.fcmToken;
  state.fcmToken = null;
  try {
    if (token) {
      const tokenId = await sha256Hex(token);
      await deleteDoc(doc(db, "fcmTokens", tokenId));
    }
  } catch (error) {
    console.warn("[Aide] Could not remove the push token document.", error);
  }
  if (state.messaging) {
    try {
      await deleteToken(state.messaging);
    } catch {
      /* Token may already be invalid. */
    }
  }
  state.messageUnsub?.();
  state.messageUnsub = null;
}

async function sendTestNotification() {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    showToast("Notifications are not supported in this browser.", "warning");
    return;
  }
  if (Notification.permission !== "granted") {
    await enablePush();
    if (Notification.permission !== "granted") return;
  }
  try {
    const registration =
      state.swRegistration ||
      (await withTimeout(navigator.serviceWorker.ready, 8000, null).catch(() => null));
    if (!registration) throw new Error("Service worker unavailable.");
    await registration.showNotification("Aide iPhone", {
      body: "Push notifications are working on this device. This is a local test.",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      tag: "aide-local-test",
      data: { url: "./?view=alerts" },
    });
    showToast("Test notification sent.", "success");
  } catch (error) {
    console.warn("[Aide] Test notification failed.", error);
    showToast("Could not show a notification. Check your browser permission.", "error");
  }
}

/* ==========================================================================
   Telemetry collection
   ========================================================================== */

function startTelemetry() {
  clearInterval(state.telemetryTimer);
  if (!state.user) return;
  initAmbientSensor().catch(() => {});
  pushTelemetry();
  state.telemetryTimer = setInterval(() => {
    if (!state.user) return;
    // Browsers throttle background timers; refresh when the tab becomes active again.
    if (document.hidden && state.lastSyncAt && Date.now() - state.lastSyncAt.getTime() < 4 * 60_000) return;
    pushTelemetry();
  }, TELEMETRY_INTERVAL_MS);
  tickClock();
}

async function initAmbientSensor() {
  if (state.ambientSensor || !("AmbientLightSensor" in window)) return;
  try {
    const sensor = new window.AmbientLightSensor({ frequency: 1 });
    sensor.addEventListener("reading", () => {
      if (Number.isFinite(sensor.illuminance)) state.ambientLux = sensor.illuminance;
    });
    sensor.start();
    state.ambientSensor = sensor;
  } catch (error) {
    // Permission-gated on most browsers. Fall back to appearance-based estimation.
    console.info("[Aide] Ambient light sensor unavailable; using estimated brightness.", error?.message || error);
  }
}

function batterySnapshot(manager) {
  return {
    supported: true,
    level: manager.level,
    percent: Math.round(manager.level * 100),
    charging: Boolean(manager.charging),
    chargingTime: Number.isFinite(manager.chargingTime) ? manager.chargingTime : null,
    dischargingTime: Number.isFinite(manager.dischargingTime) ? manager.dischargingTime : null,
  };
}

async function collectBattery() {
  if (typeof navigator.getBattery !== "function") {
    return {
      supported: false,
      reason: "The Battery Status API is not available in this browser (Safari/iOS does not expose it).",
    };
  }
  try {
    const manager = state.batteryManager || (await withTimeout(navigator.getBattery(), 3000, null));
    if (!manager) throw new Error("Battery information timed out.");
    state.batteryManager = manager;
    attachBatteryListeners(manager);
    return batterySnapshot(manager);
  } catch (error) {
    return { supported: false, reason: error?.message || "Battery information is unavailable." };
  }
}

function attachBatteryListeners(manager) {
  if (state.batteryListenersAttached) return;
  state.batteryListenersAttached = true;
  const update = () => {
    if (!state.lastContext) return;
    state.lastContext.battery = batterySnapshot(manager);
    if (state.telemetryEnabled) renderTelemetry(state.lastContext);
    renderTicketContextPreview();
  };
  manager.addEventListener("levelchange", update);
  manager.addEventListener("chargingchange", update);
}

function locationErrorLabel(code) {
  return (
    {
      1: "Location permission was denied.",
      2: "Location is currently unavailable on this device.",
      3: "The location request timed out.",
    }[code] || "Location could not be determined."
  );
}

function lastKnownLocation(reason) {
  if (state.lastLocation && Date.now() - state.lastLocation.timestamp < 10 * 60_000) {
    return { ...state.lastLocation, stale: true, reason };
  }
  return { supported: true, error: reason, timestamp: new Date().toISOString() };
}

async function collectLocation() {
  if (!navigator.geolocation) {
    return { supported: false, error: "Geolocation is not supported in this browser." };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timeout = setTimeout(() => finish(lastKnownLocation("The location request timed out.")), 9500);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(timeout);
        const coords = position.coords;
        const result = {
          supported: true,
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: Number.isFinite(coords.accuracy) ? Math.round(coords.accuracy) : null,
          altitude: Number.isFinite(coords.altitude) ? coords.altitude : null,
          heading: Number.isFinite(coords.heading) ? coords.heading : null,
          speed: Number.isFinite(coords.speed) ? coords.speed : null,
          timestamp: new Date(position.timestamp || Date.now()).toISOString(),
          stale: false,
        };
        state.lastLocation = result;
        finish(result);
      },
      (error) => {
        clearTimeout(timeout);
        finish(lastKnownLocation(locationErrorLabel(error?.code)));
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

function collectDisplay() {
  const darkMode = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? true;
  const lux = Number.isFinite(state.ambientLux) ? state.ambientLux : null;
  let percent;
  let estimateLabel;
  if (lux !== null) {
    percent = Math.round(clamp((Math.log10(lux + 1) / 3.2) * 100, 5, 100));
    estimateLabel = "Estimated from ambient light sensor";
  } else {
    percent = darkMode ? 28 : 72;
    estimateLabel = darkMode ? "Estimated · dark appearance" : "Estimated · light appearance";
  }
  return {
    brightnessPercent: percent,
    lux,
    darkMode,
    ambientLightSupported: "AmbientLightSensor" in window,
    estimateLabel,
    note: "Mobile browsers do not expose hardware screen brightness; this value is an estimate.",
  };
}

function formatUtcOffset(offsetMinutes) {
  const sign = offsetMinutes >= 0 ? "+" : "−";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

function buildTimeInfo() {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  return {
    iso: now.toISOString(),
    localTime: now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    dateTime: now.toLocaleString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Unknown timezone",
    offsetMinutes,
    utcOffset: formatUtcOffset(offsetMinutes),
    locale: navigator.language || "unknown",
  };
}

function buildDeviceInfo() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  return {
    os: DEVICE_INFO.os,
    browser: DEVICE_INFO.browser,
    browserVersion: DEVICE_INFO.browserVersion,
    deviceType: DEVICE_INFO.deviceType,
    language: navigator.language || "",
    languages: (navigator.languages || []).slice(0, 4),
    platform: navigator.platform || "",
    screenWidth: window.screen?.width ?? null,
    screenHeight: window.screen?.height ?? null,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    standalone: isStandalone(),
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemory: navigator.deviceMemory || null,
    touch: navigator.maxTouchPoints > 0,
    online: navigator.onLine,
    connection: connection
      ? {
          type: connection.type || "unknown",
          effectiveType: connection.effectiveType || "unknown",
          downlink: Number.isFinite(connection.downlink) ? connection.downlink : null,
          rtt: Number.isFinite(connection.rtt) ? connection.rtt : null,
          saveData: Boolean(connection.saveData),
        }
      : null,
    userAgent: navigator.userAgent,
  };
}

async function permissionState(name) {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const status = await navigator.permissions.query({ name });
    return status.state;
  } catch {
    return "unknown";
  }
}

async function getPermissionSnapshot() {
  const notifications = "Notification" in window ? Notification.permission : "unsupported";
  return {
    geolocation: await permissionState("geolocation"),
    notifications,
    battery: typeof navigator.getBattery === "function",
    pushConfigured: Boolean(VAPID_PUBLIC_KEY),
  };
}

/**
 * Captures a full diagnostic snapshot. `sensitive: false` keeps only the
 * basic context needed to route a support request.
 */
async function collectContext({ sensitive = true } = {}) {
  const device = buildDeviceInfo();
  const time = buildTimeInfo();
  const permissions = await getPermissionSnapshot();

  if (!sensitive) {
    return {
      capturedAt: new Date().toISOString(),
      sharing: false,
      appVersion: APP_VERSION,
      battery: { supported: false, skipped: true, reason: "Diagnostics sharing is disabled." },
      gps: { supported: false, skipped: true, error: "Diagnostics sharing is disabled." },
      display: { skipped: true, note: "Diagnostics sharing is disabled." },
      time,
      device,
      permissions,
    };
  }

  const [battery, gps, display] = await Promise.all([collectBattery(), collectLocation(), collectDisplay()]);
  return {
    capturedAt: new Date().toISOString(),
    sharing: true,
    appVersion: APP_VERSION,
    battery,
    gps,
    display,
    time,
    device,
    permissions,
  };
}

async function pushTelemetry({ notify = false } = {}) {
  if (!state.user) return false;
  if (state.telemetryBusy) {
    if (notify) showToast("A diagnostics refresh is already running.", "info", 2500);
    return false;
  }
  state.telemetryBusy = true;
  try {
    const sensitive = state.telemetryEnabled;
    const context = await collectContext({ sensitive });
    state.lastContext = context;
    renderTelemetry(context);

    const nowIso = new Date().toISOString();
    const payload = {
      uid: state.user.uid,
      email: state.user.email || "",
      name: state.displayName || "User",
      online: true,
      sharing: sensitive,
      updatedAt: serverTimestamp(),
      lastSeenClient: nowIso,
      appVersion: APP_VERSION,
      time: context.time,
    };

    if (sensitive) {
      payload.gps = context.gps;
      payload.battery = context.battery;
      payload.display = context.display;
      payload.device = context.device;
      payload.permissions = context.permissions;
      payload.platform = `${context.device.os} · ${context.device.browser}`;
    } else {
      payload.gps = deleteField();
      payload.battery = deleteField();
      payload.display = deleteField();
      payload.device = deleteField();
      payload.permissions = deleteField();
      payload.platform = deleteField();
    }

    await setDoc(doc(db, "telemetry", state.user.uid), payload, { merge: true });
    state.lastSyncAt = new Date();
    state.syncFailed = false;
    state.syncError = "";
    updateSyncUI();
    renderPermissionChips();
    renderTicketContextPreview();
    if (notify) {
      showToast(
        sensitive ? "Diagnostics refreshed for your technician." : "Presence refreshed. Diagnostics sharing is off.",
        "success",
      );
    }
    return true;
  } catch (error) {
    console.warn("[Aide] Telemetry sync failed.", error);
    state.syncFailed = true;
    state.syncError = error?.message || "Sync failed";
    updateSyncUI();
    if (notify) {
      showToast(
        navigator.onLine
          ? "Diagnostics could not be synced. Please check your permissions and try again."
          : "You are offline. Diagnostics will sync when the connection returns.",
        "warning",
      );
    }
    return false;
  } finally {
    state.telemetryBusy = false;
  }
}

function setTelemetryEnabled(enabled) {
  state.telemetryEnabled = Boolean(enabled);
  writeStoredBoolean(TELEMETRY_PREF_KEY, state.telemetryEnabled);
  renderTelemetryToggles();
  updateSyncUI();
  renderTicketContextPreview();
  if (state.lastContext) state.lastContext.sharing = state.telemetryEnabled;
  showToast(
    state.telemetryEnabled
      ? "Diagnostics sharing is on. This helps technicians diagnose faster."
      : "Diagnostics sharing is off. Only presence and basic ticket context are sent.",
    state.telemetryEnabled ? "success" : "info",
    5000,
  );
  if (state.user) pushTelemetry();
}

function renderTelemetryToggles() {
  qsa(".js-telemetry-toggle").forEach((toggle) => {
    toggle.checked = state.telemetryEnabled;
  });
}

/* ==========================================================================
   Telemetry UI
   ========================================================================== */

function renderTelemetry(context) {
  const sharing = state.telemetryEnabled && context.sharing;
  const battery = context.battery || {};
  const gps = context.gps || {};
  const display = context.display || {};
  const time = context.time || buildTimeInfo();
  const device = context.device || buildDeviceInfo();

  if (!sharing) {
    setText("#liveBatteryValue", "Paused");
    setText("#liveBatteryHint", "Sharing is off");
    setBatteryFill(0, false);
    setText("#liveLocationValue", "Paused");
    setText("#liveLocationHint", "Sharing is off");
    setText("#liveLightValue", "Paused");
    setText("#liveLightHint", "Sharing is off");
    setText("#diagnosticsBadge", "Paused");
  } else {
    if (battery.supported && Number.isFinite(battery.level)) {
      setText("#liveBatteryValue", `${battery.percent}%`);
      setText(
        "#liveBatteryHint",
        battery.charging
          ? battery.chargingTime
            ? `Charging · full in ${Math.round(battery.chargingTime / 60)} min`
            : "Charging"
          : battery.dischargingTime
            ? `On battery · ~${Math.round(battery.dischargingTime / 60)} min left`
            : "On battery",
      );
      setBatteryFill(battery.percent, battery.percent <= 20 && !battery.charging);
    } else {
      setText("#liveBatteryValue", "Unavailable");
      setText("#liveBatteryHint", battery.reason || "Battery API not available");
      setBatteryFill(0, false);
    }

    if (Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      setText("#liveLocationValue", `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}`);
      setText("#liveLocationHint", gps.stale ? "Last known position" : `Accurate to ±${gps.accuracy ?? "?"} m`);
    } else {
      setText("#liveLocationValue", gps.error ? "Not available" : "Waiting");
      setText("#liveLocationHint", gps.error || "Location is being determined");
    }

    if (Number.isFinite(display.brightnessPercent)) {
      setText("#liveLightValue", `${display.brightnessPercent}%`);
      setText(
        "#liveLightHint",
        Number.isFinite(display.lux) ? `${display.estimateLabel} · ${Math.round(display.lux)} lux` : display.estimateLabel,
      );
    } else {
      setText("#liveLightValue", "Unavailable");
      setText("#liveLightHint", "Display estimate unavailable");
    }
    setText("#diagnosticsBadge", "Live");
  }

  qs("#diagnosticsBadge")?.classList.toggle("badge-warning", !sharing);
  qs("#diagnosticsBadge")?.classList.toggle("badge-brand", sharing);

  setText("#liveTimeValue", time.localTime || "—");
  setText("#liveTimeHint", time.timezone || "—");
  setText("#liveTimezoneValue", time.timezone || "—");
  setText("#liveTimezoneHint", time.utcOffset || "—");
  setText("#liveNetworkValue", device.connection?.effectiveType ? device.connection.effectiveType.toUpperCase() : navigator.onLine ? "Online" : "Offline");
  setText(
    "#liveNetworkHint",
    device.connection
      ? `${device.connection.type || "network"}${Number.isFinite(device.connection.downlink) ? ` · ${device.connection.downlink} Mbps` : ""}`
      : "Connection details unavailable",
  );
  setText("#liveDeviceValue", `${device.os || "Device"} · ${device.browser || "Browser"}`);
  setText("#liveDeviceHint", `${device.screenWidth || "?"}×${device.screenHeight || "?"} · ${device.standalone ? "Installed" : "Browser"}`);
  setText("#lastSyncValue", state.lastSyncAt ? "Just now" : "Pending");
  setText("#lastSyncHint", state.telemetryEnabled ? "Automatic every 60s" : "Sharing paused");
  updateSyncUI();
  renderTicketContextPreview();
  renderPermissionChips();
}

function setBatteryFill(percent, low) {
  const fill = qs("#liveBatteryFill");
  if (!fill) return;
  fill.style.width = `${clamp(percent || 0, 0, 100)}%`;
  fill.classList.toggle("is-low", Boolean(low));
}

function updateSyncUI() {
  const dot = qs("#heroStatusDot");
  const text = qs("#syncStatusText");
  const hint = qs("#syncStatusHint");

  let label;
  let caption;
  let color;
  if (!state.telemetryEnabled) {
    label = "Diagnostics sharing is off";
    caption = "Presence stays visible, but battery, location and device details are not shared.";
    color = "#fbbf24";
  } else if (state.syncFailed) {
    label = navigator.onLine ? "Diagnostics sync paused" : "Offline — sync pending";
    caption = navigator.onLine
      ? "We could not reach Firebase. Aide will retry automatically; you can still open a ticket."
      : "Your data will sync automatically as soon as the connection returns.";
    color = "#fb7185";
  } else if (!state.lastSyncAt) {
    label = "Syncing diagnostics…";
    caption = "Collecting battery, location, display estimate and local time.";
    color = "#fbbf24";
  } else {
    label = "Live diagnostics synced";
    caption = "A technician can see the context they need when you ask for help.";
    color = "#34d399";
  }

  if (text) text.textContent = label;
  if (hint) hint.textContent = caption;
  if (dot) {
    dot.style.background = color;
    dot.style.boxShadow = `0 0 0 3px ${color}22`;
  }
  const lastSync = qs("#lastSyncValue");
  if (lastSync) lastSync.textContent = state.lastSyncAt ? timeAgo(state.lastSyncAt) : "Pending";
  const lastHint = qs("#lastSyncHint");
  if (lastHint) lastHint.textContent = state.telemetryEnabled ? "Automatic every 60s" : "Sharing paused";
  qs("#diagnosticsBadge")?.classList.toggle("badge-warning", !state.telemetryEnabled || state.syncFailed);
  qs("#diagnosticsBadge")?.classList.toggle("badge-brand", state.telemetryEnabled && !state.syncFailed);
  if (state.telemetryEnabled && state.syncFailed) {
    const badge = qs("#diagnosticsBadge");
    if (badge) badge.textContent = "Retrying";
  } else if (state.telemetryEnabled) {
    const badge = qs("#diagnosticsBadge");
    if (badge) badge.textContent = "Live";
  } else {
    const badge = qs("#diagnosticsBadge");
    if (badge) badge.textContent = "Paused";
  }
}

function renderPermissionChips() {
  const target = qs("#permissionChips");
  if (!target) return;
  const snap = state.lastContext?.permissions;
  const geo = snap?.geolocation || (state.lastLocation?.latitude ? "granted" : "unknown");
  const notifications = "Notification" in window ? Notification.permission : "unsupported";
  const batteryOk = typeof navigator.getBattery === "function";

  const chip = (label, status, tone) =>
    `<span class="permission-chip ${tone || ""}"><span class="status-dot" style="background: currentColor"></span>${escapeHtml(
      label,
    )}: ${escapeHtml(status)}</span>`;

  const geoLabel =
    geo === "granted"
      ? state.lastContext?.gps?.latitude
        ? "Shared"
        : "Allowed"
      : geo === "denied"
        ? "Denied"
        : geo === "prompt"
          ? "Ask on refresh"
          : "Unknown";
  const geoClass = geo === "granted" ? "is-ok" : geo === "denied" ? "is-off" : "is-warn";
  const notificationLabel =
    notifications === "granted" ? "On" : notifications === "denied" ? "Blocked" : notifications === "unsupported" ? "Unsupported" : "Off";
  const notificationClass =
    notifications === "granted" ? "is-ok" : notifications === "denied" || notifications === "unsupported" ? "is-off" : "is-warn";

  target.innerHTML = [
    chip("Location", state.telemetryEnabled ? geoLabel : "Sharing off", state.telemetryEnabled ? geoClass : "is-warn"),
    chip("Notifications", notificationLabel, notificationClass),
    chip("Battery API", batteryOk ? "Supported" : "Not available", batteryOk ? "is-ok" : "is-warn"),
    chip("Diagnostics", state.telemetryEnabled ? "On" : "Off", state.telemetryEnabled ? "is-ok" : "is-off"),
  ].join("");
}

function renderTicketContextPreview() {
  const target = qs("#ticketContextPreview");
  if (!target) return;
  const ctx = state.lastContext;
  if (!state.telemetryEnabled) {
    target.innerHTML = `<span class="permission-chip is-warn">Diagnostics sharing is off — only OS, browser and time will be attached.</span>`;
    return;
  }
  const battery = ctx?.battery?.supported && Number.isFinite(ctx.battery.level) ? `${ctx.battery.percent}%` : null;
  const location = Number.isFinite(ctx?.gps?.latitude) ? "Location ready" : ctx?.gps?.error ? "Location unavailable" : "Location pending";
  target.innerHTML = [
    `<span class="permission-chip is-ok">${escapeHtml(ctx?.device?.os || DEVICE_INFO.os)} · ${escapeHtml(ctx?.device?.browser || DEVICE_INFO.browser)}</span>`,
    `<span class="permission-chip ${battery ? "is-ok" : "is-warn"}">Battery ${escapeHtml(battery || "N/A")}</span>`,
    `<span class="permission-chip ${Number.isFinite(ctx?.gps?.latitude) ? "is-ok" : "is-warn"}">${escapeHtml(location)}</span>`,
    `<span class="permission-chip is-ok">${escapeHtml(ctx?.time?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "Timezone")}</span>`,
  ].join("");
}

function updateNetworkUI() {
  const online = navigator.onLine;
  const pill = qs("#netPill");
  const dot = qs("#netDot");
  const label = qs("#netLabel");
  const banner = qs("#offlineBanner");
  pill?.classList.toggle("is-offline", !online);
  dot?.classList.toggle("is-offline", !online);
  if (label) label.textContent = online ? "Online" : "Offline";
  banner?.classList.toggle("hidden", online);
}

function updateGreeting() {
  const now = new Date();
  const hour = now.getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const firstName = String(state.displayName || "").trim().split(/\s+/)[0];
  const greeting = state.user
    ? `Good ${part}${firstName ? `, ${firstName}` : ""}`
    : `Good ${part}`;
  setText("#homeGreeting", greeting);
  setText(
    "#homeDate",
    new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now),
  );
  const hourNow = now.getHours();
  const hero = qs("#heroTitle");
  if (hero) {
    const openTicket = state.tickets.find((ticket) => ticket.status === "in_progress");
    const waitingTicket = state.tickets.find((ticket) => ticket.status === "pending");
    hero.textContent = openTicket
      ? "A technician is working on your request."
      : waitingTicket
        ? "Your request is in the support queue."
        : hourNow >= 22 || hourNow < 6
          ? "Late-night issues are still welcome."
          : "We are ready to help.";
  }
}

function tickClock() {
  const clock = qs("#liveTimeValue");
  if (clock) {
    clock.textContent = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const lastSync = qs("#lastSyncValue");
  if (lastSync) lastSync.textContent = state.lastSyncAt ? timeAgo(state.lastSyncAt) : "Pending";
}

/* ==========================================================================
   Alerts
   ========================================================================== */

function startAlerts() {
  state.alertsUnsub?.();
  const alertsQuery = query(collection(db, "alerts"), where("active", "==", true), limit(50));
  state.alertsUnsub = onSnapshot(
    alertsQuery,
    (snapshot) => {
      state.alerts = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
      renderAlerts();
      queueAlerts();
      handleAlertDeepLink({ fromCache: snapshot.metadata.fromCache });
    },
    (error) => {
      console.warn("[Aide] Alert listener failed.", error);
    },
  );
}

/**
 * A push notification can link to `?view=alerts&alert=<id>`. Open that exact
 * alert once the alert listener has delivered it, even if it was already seen.
 */
function handleAlertDeepLink({ fromCache = false } = {}) {
  if (!state.pendingAlertId) return;
  const alert = visibleAlerts().find((item) => item.id === state.pendingAlertId);
  if (!alert) {
    // A cached snapshot may not contain the new alert yet; wait for the server.
    if (!fromCache) {
      state.pendingAlertId = null;
      clearQueryParam("alert");
    }
    return;
  }
  state.pendingAlertId = null;
  clearQueryParam("alert");
  if (!state.currentAlert) presentAlert(alert);
}

function visibleAlerts() {
  if (!state.user) return [];
  const uid = state.user.uid;
  const now = Date.now();
  return state.alerts
    .filter((alert) => alert.active !== false)
    .filter((alert) => {
      const expires = toDate(alert.expiresAt);
      return !expires || expires.getTime() > now;
    })
    .filter((alert) => {
      if (!alert.audience || alert.audience === "all") return true;
      return Array.isArray(alert.targetUids) && alert.targetUids.includes(uid);
    })
    .sort((a, b) => {
      const weight = { critical: 3, warning: 2, info: 1 };
      const diff = (weight[b.severity] || 0) - (weight[a.severity] || 0);
      if (diff !== 0) return diff;
      return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
    });
}

function alertVersion(alert) {
  return String(toDate(alert.updatedAt || alert.createdAt)?.getTime() || 0);
}

function isAlertSeen(alert) {
  const seenVersion = Number(state.seenAlerts[alert.id] || 0);
  return seenVersion >= Number(alertVersion(alert));
}

function markAlertSeen(alert) {
  if (!alert) return;
  state.seenAlerts[alert.id] = alertVersion(alert);
  writeSeenAlerts(state.seenAlerts);
  updateAlertBadges();
  renderHomeAlertBanner();
  renderAlerts({ keepScroll: true });
}

function readSeenAlerts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SEEN_ALERTS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeSeenAlerts(seen) {
  try {
    const entries = Object.entries(seen);
    if (entries.length > 250) {
      entries.sort((a, b) => Number(b[1]) - Number(a[1]));
      seen = Object.fromEntries(entries.slice(0, 250));
      state.seenAlerts = seen;
    }
    localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(seen));
  } catch {
    /* Storage can be unavailable in private mode. */
  }
}

function unreadAlerts() {
  return visibleAlerts().filter((alert) => !isAlertSeen(alert));
}

function updateAlertBadges() {
  const count = unreadAlerts().length;
  const headerButton = qs("#headerAlertsBtn");
  headerButton?.classList.toggle("has-dot", count > 0);
  const bottomButton = qs("#bottomAlertsBtn");
  bottomButton?.classList.toggle("has-badge", count > 0);
}

function renderAlerts({ keepScroll = false } = {}) {
  const list = qs("#alertsList");
  if (!list) return;
  const scroll = keepScroll ? window.scrollY : null;
  const alerts = visibleAlerts();
  const empty = qs("#alertsEmpty");
  empty?.classList.toggle("hidden", alerts.length > 0);
  list.innerHTML = alerts.map(alertCardMarkup).join("");
  updateAlertBadges();
  renderHomeAlertBanner();
  if (scroll !== null) window.scrollTo({ top: scroll });
}

function alertCardMarkup(alert) {
  const severity = SEVERITY_META[alert.severity] || SEVERITY_META.info;
  const acknowledged = isAlertSeen(alert);
  const targetLabel =
    alert.audience === "users" && Array.isArray(alert.targetUids) && alert.targetUids.length
      ? "Targeted alert"
      : "All users";
  return `<article class="alert-list-item ${alert.severity === "critical" ? "is-critical" : alert.severity === "warning" ? "is-warning" : ""}">
    <div class="flex flex-wrap items-center gap-2">
      <span class="badge ${severity.badge}">${escapeHtml(severity.label)}</span>
      <span class="text-[0.65rem] text-slate-500">${escapeHtml(targetLabel)}</span>
      <span class="text-[0.65rem] text-slate-500">· ${escapeHtml(formatDate(alert.createdAt))}</span>
      <span class="ml-auto">${
        acknowledged
          ? `<span class="badge badge-resolved">${icon("check", "h-3 w-3")} Acknowledged</span>`
          : `<button type="button" class="btn btn-secondary btn-sm" data-ack-alert="${escapeHtml(alert.id)}">Acknowledge</button>`
      }</span>
    </div>
    <h3 class="mt-2 text-[0.86rem] font-semibold text-slate-100">${escapeHtml(alert.title || "Notice")}</h3>
    <p class="mt-1 whitespace-pre-wrap text-[0.76rem] leading-5 text-slate-400">${escapeHtml(alert.message || "")}</p>
    <div class="mt-2 flex flex-wrap gap-2">
      <button type="button" class="btn btn-ghost btn-sm px-0" data-open-alert="${escapeHtml(alert.id)}">View alert →</button>
    </div>
  </article>`;
}

function renderHomeAlertBanner() {
  const container = qs("#homeAlertBanner");
  if (!container) return;
  const alert = unreadAlerts()[0];
  if (!alert) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  const severity = SEVERITY_META[alert.severity] || SEVERITY_META.info;
  const tone = alert.severity === "critical" ? "critical" : alert.severity === "warning" ? "" : "info";
  container.className = `mb-4 alert-banner ${tone}`;
  container.innerHTML = `
    <div class="alert-banner-icon">${icon(severity.icon, "h-4 w-4")}</div>
    <div class="min-w-0 flex-1">
      <h3>${escapeHtml(alert.title || "Important alert")}</h3>
      <p>${escapeHtml((alert.message || "").slice(0, 220))}</p>
    </div>
    <button type="button" class="btn btn-secondary btn-sm" data-open-alert="${escapeHtml(alert.id)}">Open</button>`;
}

function queueAlerts() {
  if (!state.user) return;
  const alerts = visibleAlerts();
  for (const alert of alerts) {
    if (isAlertSeen(alert)) continue;
    if (state.currentAlert?.id === alert.id) continue;
    if (state.alertQueue.some((item) => item.id === alert.id)) continue;
    state.alertQueue.push(alert);
  }
  if (state.alertQueue.length) setTimeout(showNextAlert, 450);
}

function showNextAlert() {
  if (state.currentAlert || !state.user || !state.alertQueue.length) return;
  const alert = state.alertQueue.shift();
  if (!alert || isAlertSeen(alert)) {
    showNextAlert();
    return;
  }
  presentAlert(alert);
}

function presentAlert(alert) {
  const overlay = qs("#alertOverlay");
  const sheet = qs("#alertSheet");
  if (!overlay || !sheet) return;
  state.currentAlert = alert;
  const severity = SEVERITY_META[alert.severity] || SEVERITY_META.info;
  sheet.className = `alert-sheet ${alert.severity || "info"}`;
  setText("#alertMeta", `${severity.label} · ${formatDate(alert.createdAt)}`);
  setText("#alertTitle", alert.title || "Important alert");
  setText("#alertMessage", alert.message || "");
  qs("#alertIcon").innerHTML = icon(severity.icon, "h-7 w-7");
  setText("#alertAckBtn", isAlertSeen(alert) ? "Close" : "Acknowledge");
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => qs("#alertAckBtn")?.focus({ preventScroll: true }), 100);
}

function closeAlertModal({ ack = false, notify = false } = {}) {
  const alert = state.currentAlert;
  const overlay = qs("#alertOverlay");
  overlay?.classList.add("hidden");
  overlay?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  state.currentAlert = null;
  if (alert) {
    markAlertSeen(alert);
    if (ack) acknowledgeAlert(alert, { notify });
  }
  setTimeout(showNextAlert, 280);
}

async function acknowledgeAlert(alert, { notify = false } = {}) {
  if (!alert || !state.user) return;
  markAlertSeen(alert);
  try {
    await setDoc(
      doc(db, "alerts", alert.id, "acknowledgements", state.user.uid),
      {
        uid: state.user.uid,
        alertId: alert.id,
        acknowledgedAt: serverTimestamp(),
        appVersion: APP_VERSION,
        userAgent: navigator.userAgent,
      },
      { merge: true },
    );
    if (notify) showToast("Alert acknowledged.", "success");
  } catch (error) {
    console.warn("[Aide] Could not record alert acknowledgement.", error);
    if (notify) showToast("Alert marked locally. The acknowledgement could not be synced.", "warning");
  }
  renderAlerts();
}

async function acknowledgeAllAlerts() {
  const alerts = unreadAlerts();
  if (!alerts.length) {
    showToast("There are no unread alerts.", "info");
    return;
  }
  alerts.forEach((alert) => markAlertSeen(alert));
  const results = await Promise.allSettled(alerts.map((alert) => acknowledgeAlert(alert)));
  const failures = results.filter((result) => result.status === "rejected").length;
  showToast(
    failures ? "Alerts acknowledged locally; some could not be synced." : "All alerts acknowledged.",
    failures ? "warning" : "success",
  );
  renderAlerts();
}

function openAlertById(id) {
  const alert = visibleAlerts().find((item) => item.id === id);
  if (!alert) {
    showToast("That alert is no longer active.", "info");
    return;
  }
  if (state.currentAlert && state.currentAlert.id !== alert.id) {
    markAlertSeen(state.currentAlert);
  }
  state.alertQueue = state.alertQueue.filter((item) => item.id !== alert.id);
  presentAlert(alert);
}

/* ==========================================================================
   Tickets
   ========================================================================== */

function startTickets() {
  state.ticketsUnsub?.();
  state.ticketsReady = false;
  state.ticketStatuses.clear();
  renderTickets();
  renderHomeTickets();
  if (!state.user) return;

  const ticketsQuery = query(collection(db, "tickets"), where("userId", "==", state.user.uid), limit(100));
  state.ticketsUnsub = onSnapshot(
    ticketsQuery,
    (snapshot) => {
      const tickets = snapshot.docs
        .map((document) => ({ id: document.id, ...document.data() }))
        .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));

      if (state.ticketsReady) {
        for (const ticket of tickets) {
          const previous = state.ticketStatuses.get(ticket.id);
          if (previous && previous !== ticket.status) {
            const label = STATUS_META[ticket.status]?.label || ticket.status;
            showToast(
              `Ticket “${ticket.subject || "Support request"}” is now ${label}.`,
              ticket.status === "resolved" ? "success" : "info",
              7000,
            );
          }
        }
      }

      tickets.forEach((ticket) => state.ticketStatuses.set(ticket.id, ticket.status));
      state.tickets = tickets;
      state.ticketsReady = true;
      renderTickets();
      renderHomeTickets();
      updateGreeting();
      handleTicketDeepLink({ fromCache: snapshot.metadata.fromCache });
    },
    (error) => {
      console.warn("[Aide] Ticket listener failed.", error);
      state.ticketsReady = true;
      const list = qs("#ticketList");
      if (list) {
        list.innerHTML = `<div class="empty-state"><span class="empty-state-icon">${icon("alert-circle", "h-6 w-6")}</span>
          <h3>Could not load tickets</h3><p>${escapeHtml(error?.message || "Check your connection and try again.")}</p></div>`;
      }
    },
  );
}

/**
 * A push notification can link to `?view=support&ticket=<id>`. Open the ticket
 * detail modal as soon as the user's real-time ticket data is available.
 */
function handleTicketDeepLink({ fromCache = false } = {}) {
  if (!state.pendingTicketId) return;
  const ticket = state.tickets.find((item) => item.id === state.pendingTicketId);
  if (!ticket) {
    if (!fromCache) {
      state.pendingTicketId = null;
      clearQueryParam("ticket");
      showToast("That support request could not be found.", "info");
    }
    return;
  }
  state.pendingTicketId = null;
  clearQueryParam("ticket");
  goTo("support", { scroll: false });
  setTimeout(() => openTicket(ticket.id), 120);
}

function filteredTickets() {
  const filter = state.ticketFilter;
  if (filter === "open") return state.tickets.filter((ticket) => ticket.status !== "resolved");
  if (filter === "resolved") return state.tickets.filter((ticket) => ticket.status === "resolved");
  return state.tickets;
}

function renderTickets() {
  const list = qs("#ticketList");
  if (!list || !state.ticketsReady) return;
  const tickets = filteredTickets();
  const empty = qs("#ticketEmpty");
  const isEmpty = tickets.length === 0;
  empty?.classList.toggle("hidden", !isEmpty);
  if (empty) {
    const title = empty.querySelector("h3");
    const copy = empty.querySelector("p");
    if (title) title.textContent = state.ticketFilter === "all" ? "No tickets yet" : "No matching tickets";
    if (copy) {
      copy.textContent =
        state.ticketFilter === "all"
          ? "When you submit a request it will appear here with live status updates."
          : "Try another filter, or open a new support request.";
    }
  }
  list.innerHTML = tickets.map(ticketCardMarkup).join("");
}

function ticketCardMarkup(ticket) {
  const category = CATEGORY_MAP[ticket.category] || { label: "Other", icon: "help" };
  const attachmentCount = Array.isArray(ticket.attachments) ? ticket.attachments.length : 0;
  const priority = ticket.priority && ["high", "urgent"].includes(ticket.priority)
    ? `<span class="badge ${ticket.priority === "urgent" ? "badge-critical" : "badge-warning"}">${escapeHtml(ticket.priority)}</span>`
    : "";
  return `<button type="button" class="ticket-card" data-ticket-id="${escapeHtml(ticket.id)}">
    <div class="ticket-card-top">
      <span class="badge badge-neutral">${icon(category.icon, "h-3 w-3")} ${escapeHtml(category.label)}</span>
      ${statusBadge(ticket.status)}
      ${priority}
      <span class="ml-auto text-[0.62rem] text-slate-500">#${escapeHtml(ticket.id.slice(0, 6).toUpperCase())}</span>
    </div>
    <h3 class="mt-2">${escapeHtml(ticket.subject || "Support request")}</h3>
    <p>${escapeHtml(ticket.description || "")}</p>
    <div class="ticket-meta">
      <span>${icon("clock", "h-3 w-3")} ${escapeHtml(formatDate(ticket.createdAt))}</span>
      ${attachmentCount ? `<span>${icon("paperclip", "h-3 w-3")} ${attachmentCount} file${attachmentCount > 1 ? "s" : ""}</span>` : ""}
      ${ticket.technicianName ? `<span>${icon("user", "h-3 w-3")} ${escapeHtml(ticket.technicianName)}</span>` : ""}
    </div>
  </button>`;
}

function renderHomeTickets() {
  const container = qs("#openTicketsList");
  if (!container) return;
  if (!state.ticketsReady) {
    container.innerHTML = `<div class="loading-line"><span class="spinner"></span> Loading tickets…</div>`;
    return;
  }
  const cutoff = Date.now() - 30 * 86_400_000;
  const recent = state.tickets.filter((ticket) => {
    const created = toDate(ticket.createdAt);
    return !created || created.getTime() >= cutoff;
  });
  setText("#openTicketsCount", String(recent.length));
  const open = state.tickets.filter((ticket) => ticket.status !== "resolved").slice(0, 3);
  if (!open.length) {
    container.innerHTML = `<div class="empty-state py-5">
      <span class="empty-state-icon">${icon("check-circle", "h-5 w-5")}</span>
      <h3>No open requests</h3>
      <p>Everything is resolved. If something changes, we are one tap away.</p>
    </div>`;
    return;
  }
  container.innerHTML = open
    .map(
      (ticket) => `<button type="button" class="mini-ticket" data-ticket-id="${escapeHtml(ticket.id)}">
        <span class="status-dot" style="background:${ticket.status === "in_progress" ? "#22d3ee" : "#fbbf24"}"></span>
        <span class="mini-title">${escapeHtml(ticket.subject || "Support request")}</span>
        ${statusBadge(ticket.status)}
      </button>`,
    )
    .join("");
}

function ticketStepper(status) {
  const order = ["pending", "in_progress", "resolved"];
  const current = Math.max(0, order.indexOf(status));
  return `<div class="stepper" aria-label="Ticket progress">
    ${order
      .map((step, index) => {
        const meta = STATUS_META[step];
        const className = index < current ? "is-done" : index === current ? "is-current" : "";
        return `<div class="stepper-step ${className}">
          <span class="stepper-dot">${index < current ? icon("check", "h-2.5 w-2.5") : ""}</span>
          <span class="stepper-label">${escapeHtml(meta.label)}</span>
        </div>`;
      })
      .join("")}
  </div>`;
}

function contextItems(context = {}) {
  const items = [];
  const device = context.device || {};
  const battery = context.battery || {};
  const gps = context.gps || {};
  const display = context.display || {};
  const time = context.time || {};
  items.push({ label: "Device", value: `${device.os || "Unknown OS"} · ${device.browser || "Unknown browser"}` });
  if (device.screenWidth) {
    items.push({
      label: "Screen",
      value: `${device.screenWidth}×${device.screenHeight} @${device.devicePixelRatio || 1}x`,
    });
  }
  if (battery.skipped) {
    items.push({ label: "Battery", value: "Sharing disabled" });
  } else if (battery.supported) {
    items.push({
      label: "Battery",
      value: `${battery.percent ?? "?"}% · ${battery.charging ? "charging" : "on battery"}`,
    });
  } else {
    items.push({ label: "Battery", value: battery.reason || "Unavailable" });
  }
  if (gps.skipped) {
    items.push({ label: "Location", value: "Sharing disabled" });
  } else if (Number.isFinite(gps.latitude)) {
    items.push({
      label: "Location",
      value: `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}${Number.isFinite(gps.accuracy) ? ` ±${gps.accuracy}m` : ""}`,
    });
  } else {
    items.push({ label: "Location", value: gps.error || "Unavailable" });
  }
  if (Number.isFinite(display.brightnessPercent)) {
    items.push({
      label: "Display estimate",
      value: `${display.brightnessPercent}%${Number.isFinite(display.lux) ? ` · ${Math.round(display.lux)} lux` : ""}`,
    });
  }
  if (time.localTime) {
    items.push({ label: "Local time", value: `${time.localTime} · ${time.timezone || ""}` });
  }
  if (time.utcOffset) items.push({ label: "UTC offset", value: time.utcOffset });
  if (device.connection) {
    items.push({
      label: "Network",
      value: `${device.connection.effectiveType || "unknown"}${Number.isFinite(device.connection.downlink) ? ` · ${device.connection.downlink} Mbps` : ""}`,
    });
  }
  if (context.capturedAt) items.push({ label: "Captured", value: formatDate(context.capturedAt) });
  return items;
}

function ticketDetailBody(ticket) {
  const category = CATEGORY_MAP[ticket.category] || { label: "Other", icon: "help" };
  const attachments = Array.isArray(ticket.attachments) ? ticket.attachments : [];
  const context = ticket.context || {};
  const priority = ticket.priority
    ? `<span class="badge badge-neutral">${escapeHtml(ticket.priority)} priority</span>`
    : "";
  const resolution = ticket.resolution
    ? `<section class="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-3">
        <h3 class="text-[0.72rem] font-bold uppercase tracking-[0.1em] text-emerald-200">Resolution</h3>
        <p class="mt-1.5 whitespace-pre-wrap text-[0.8rem] leading-6 text-emerald-50/90">${escapeHtml(ticket.resolution)}</p>
        ${ticket.resolvedAt ? `<p class="mt-2 text-[0.65rem] text-emerald-200/60">Resolved ${escapeHtml(formatDate(ticket.resolvedAt))}</p>` : ""}
      </section>`
    : "";
  const message = ticket.technicianMessage
    ? `<section class="mt-4 rounded-xl border border-indigo-400/25 bg-indigo-500/10 p-3">
        <h3 class="text-[0.72rem] font-bold uppercase tracking-[0.1em] text-indigo-200">Message from technician</h3>
        <p class="mt-1.5 whitespace-pre-wrap text-[0.8rem] leading-6 text-indigo-50/90">${escapeHtml(ticket.technicianMessage)}</p>
      </section>`
    : "";
  const attachmentMarkup = attachments.length
    ? `<div class="mt-4"><h3 class="label">Attachments</h3><div class="attachment-list">${attachments
        .map(
          (file) =>
            `<a class="attachment-item" href="${escapeHtml(file.url || "#")}" target="_blank" rel="noopener noreferrer">
              ${icon("paperclip", "h-3.5 w-3.5")}
              <span class="file-name">${escapeHtml(file.name || "Attachment")}</span>
              <span>${escapeHtml(formatBytes(file.size || 0))}</span>
              ${icon("external-link", "h-3 w-3")}
            </a>`,
        )
        .join("")}</div></div>`
    : "";

  return `
    <div class="flex flex-wrap items-center gap-2">
      <span class="badge badge-neutral">${icon(category.icon, "h-3 w-3")} ${escapeHtml(category.label)}</span>
      ${statusBadge(ticket.status)}
      ${priority}
    </div>
    ${ticketStepper(ticket.status)}
    <section>
      <h3 class="section-title">${escapeHtml(ticket.subject || "Support request")}</h3>
      <p class="mt-2 whitespace-pre-wrap text-[0.82rem] leading-6 text-slate-300">${escapeHtml(ticket.description || "")}</p>
    </section>
    ${resolution}
    ${message}
    <section class="mt-4">
      <h3 class="label">Request details</h3>
      <dl class="context-grid mt-2">
        <div class="context-item"><dt>Ticket</dt><dd class="mono">#${escapeHtml(ticket.id.slice(0, 8).toUpperCase())}</dd></div>
        <div class="context-item"><dt>Created</dt><dd>${escapeHtml(formatDate(ticket.createdAt))}</dd></div>
        <div class="context-item"><dt>Updated</dt><dd>${escapeHtml(formatDate(ticket.updatedAt))}</dd></div>
        <div class="context-item"><dt>Technician</dt><dd>${escapeHtml(ticket.technicianName || "Not assigned yet")}</dd></div>
      </dl>
    </section>
    <section class="mt-4">
      <h3 class="label">Diagnostics captured at submission</h3>
      <dl class="context-grid mt-2">
        ${contextItems(context)
          .map(
            (item) =>
              `<div class="context-item"><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`,
          )
          .join("")}
      </dl>
      ${context.sharing === false ? `<p class="help-text mt-2">Diagnostics sharing was off; only basic context was captured.</p>` : ""}
    </section>
    ${attachmentMarkup}`;
}

function ticketSummaryText(ticket) {
  const category = CATEGORY_MAP[ticket.category]?.label || "Other";
  const context = ticket.context || {};
  const lines = [
    `Aide iPhone — support ticket #${ticket.id.toUpperCase()}`,
    `Status: ${STATUS_META[ticket.status]?.label || ticket.status}`,
    `Category: ${category}`,
    `Subject: ${ticket.subject || ""}`,
    `Created: ${formatDate(ticket.createdAt)}`,
    ticket.technicianName ? `Technician: ${ticket.technicianName}` : "",
    "",
    "Description:",
    ticket.description || "",
    ticket.resolution ? `\nResolution:\n${ticket.resolution}` : "",
    "",
    "Device context:",
    ...contextItems(context).map((item) => `- ${item.label}: ${item.value}`),
  ];
  return lines.filter((line) => line !== "" || true).join("\n");
}

function openTicket(ticketId) {
  const ticket = state.tickets.find((item) => item.id === ticketId);
  if (!ticket) {
    showToast("Ticket not found. It may have been archived.", "info");
    return;
  }
  const modal = openModal({
    title: ticket.subject || "Support request",
    subtitle: `${CATEGORY_MAP[ticket.category]?.label || "Support"} · #${ticket.id.slice(0, 8).toUpperCase()}`,
    body: ticketDetailBody(ticket),
    footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button>
      <button type="button" class="btn btn-primary" data-copy-ticket>${icon("copy", "h-4 w-4")} Copy summary</button>`,
    size: "lg",
  });
  modal.root.querySelector("[data-copy-ticket]")?.addEventListener("click", async () => {
    const copied = await copyText(ticketSummaryText(ticket));
    showToast(copied ? "Ticket summary copied." : "Could not access the clipboard.", copied ? "success" : "error");
  });
}

function renderCategoryOptions() {
  const container = qs("#categoryGrid");
  if (!container) return;
  container.innerHTML = CATEGORIES.map(
    (category, index) => `<label class="radio-card">
      <input type="radio" name="ticketCategory" value="${escapeHtml(category.id)}" ${index === 0 ? "checked" : ""} />
      <span class="radio-icon">${icon(category.icon, "h-4 w-4")}</span>
      <span><strong>${escapeHtml(category.label)}</strong><small>${escapeHtml(category.description)}</small></span>
    </label>`,
  ).join("");
}

function inferFileType(file) {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      heic: "image/heic",
      heif: "image/heif",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      pdf: "application/pdf",
      txt: "text/plain",
    }[extension] || ""
  );
}

function fileIsAllowed(file) {
  const type = inferFileType(file);
  return type.startsWith("image/") || type === "application/pdf" || type === "text/plain";
}

function handleTicketFiles(fileList) {
  const incoming = Array.from(fileList || []);
  for (const file of incoming) {
    if (state.ticketFiles.length >= MAX_FILES) {
      showToast(`You can attach up to ${MAX_FILES} files.`, "warning");
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(`${file.name} is larger than 8 MB.`, "warning");
      continue;
    }
    if (!fileIsAllowed(file)) {
      showToast(`${file.name} is not a supported file type.`, "warning");
      continue;
    }
    const duplicate = state.ticketFiles.some(
      (item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified,
    );
    if (!duplicate) state.ticketFiles.push(file);
  }
  renderTicketFiles();
}

function removeTicketFile(index) {
  state.ticketFiles.splice(index, 1);
  renderTicketFiles();
}

function renderTicketFiles() {
  const container = qs("#ticketFileList");
  if (!container) return;
  container.innerHTML = state.ticketFiles
    .map(
      (file, index) => `<div class="attachment-item" data-file-index="${index}">
        ${icon("file-text", "h-3.5 w-3.5")}
        <span class="file-name">${escapeHtml(file.name)}</span>
        <span>${escapeHtml(formatBytes(file.size))}</span>
        <span class="file-progress"><span></span></span>
        <button type="button" class="btn btn-ghost btn-sm" data-remove-file="${index}" aria-label="Remove ${escapeHtml(file.name)}">${icon("x", "h-3.5 w-3.5")}</button>
      </div>`,
    )
    .join("");
}

/**
 * Uploads one attachment with progress feedback. Throws a clean error so the
 * submit handler can abort the whole ticket and clean up earlier uploads.
 */
async function uploadTicketAttachment(file, index, uid) {
  const type = inferFileType(file) || "application/octet-stream";
  const path = `tickets/${uid}/${Date.now()}-${index}-${safeFileName(file.name)}`;
  const reference = storageRef(storage, path);
  const task = uploadBytesResumable(reference, file, {
    contentType: type,
    customMetadata: { ownerUid: uid },
  });
  const progress = qs(`#ticketFileList [data-file-index="${index}"] .file-progress > span`);
  await new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (progress) {
          const percent = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          progress.style.width = `${percent}%`;
        }
      },
      reject,
      resolve,
    );
  });
  const url = await getDownloadURL(reference);
  return { name: file.name, size: file.size, type, path, url, uploadedAt: new Date().toISOString() };
}

async function submitTicket(event) {
  event.preventDefault();
  if (!state.user) return;
  hideFormError("#ticketFormError");

  const category = qs('input[name="ticketCategory"]:checked')?.value || "";
  const subject = qs("#ticketSubject")?.value.trim() || "";
  const description = qs("#ticketDescription")?.value.trim() || "";
  const priority = qs("#ticketPriority")?.value || "normal";

  if (!category) {
    showFormError("#ticketFormError", "Choose the category that best matches your issue.");
    return;
  }
  if (subject.length < 4) {
    showFormError("#ticketFormError", "Add a short summary of the issue (at least 4 characters).");
    qs("#ticketSubject")?.focus();
    return;
  }
  if (description.length < 10) {
    showFormError("#ticketFormError", "Describe the issue in a little more detail (at least 10 characters).");
    qs("#ticketDescription")?.focus();
    return;
  }

  const button = qs("#ticketSubmitBtn");
  setBusy(button, true);
  const uploaded = [];
  try {
    const context = await collectContext({ sensitive: state.telemetryEnabled });
    state.lastContext = context;
    const attachments = [];

    for (let index = 0; index < state.ticketFiles.length; index += 1) {
      const file = state.ticketFiles[index];
      try {
        const attachment = await uploadTicketAttachment(file, index, state.user.uid);
        attachments.push(attachment);
        uploaded.push(attachment.path);
      } catch (error) {
        console.error("[Aide] Attachment upload failed.", error);
        throw new Error(`Could not upload ${file.name}. Check your connection and try again.`);
      }
    }

    const ticket = {
      userId: state.user.uid,
      userEmail: state.user.email || "",
      userName: state.displayName || "User",
      userIsGuest: Boolean(state.user.isAnonymous),
      category,
      subject,
      description,
      priority,
      status: "pending",
      attachments,
      context,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      technicianId: null,
      technicianName: null,
      technicianMessage: null,
      resolution: null,
      resolvedAt: null,
      appVersion: APP_VERSION,
      userAgent: navigator.userAgent,
      source: "pwa",
    };
    const reference = await addDoc(collection(db, "tickets"), ticket);

    showToast(`Request #${reference.id.slice(0, 6).toUpperCase()} submitted. We will keep you posted.`, "success", 6500);

    // Reset the form without reloading the view.
    qs("#ticketForm")?.reset();
    state.ticketFiles = [];
    renderTicketFiles();
    renderCategoryOptions();
    setText("#descriptionCount", "0");
    renderTicketContextPreview();
    goTo("support");
    setTimeout(() => {
      qs("#ticketListSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
  } catch (error) {
    console.error("[Aide] Ticket submission failed.", error);
    // Best-effort cleanup of any files uploaded before the failure.
    await Promise.allSettled(uploaded.map((path) => deleteObject(storageRef(storage, path))));
    showFormError(
      "#ticketFormError",
      error?.code === "storage/unauthorized"
        ? "The attachment could not be uploaded. Check your connection or remove the file and try again."
        : error?.code === "permission-denied"
          ? "Your account is not allowed to create tickets. Please sign out and in again."
          : error?.message || "The ticket could not be submitted. Please try again.",
    );
  } finally {
    setBusy(button, false);
  }
}

/* ==========================================================================
   Guides, videos and FAQs
   ========================================================================== */

function renderGuides() {
  const categoryContainer = qs("#guideCategories");
  if (categoryContainer) {
    categoryContainer.innerHTML = GUIDE_CATEGORIES.map(
      (category) =>
        `<button type="button" class="chip ${state.guideCategory === category.id ? "is-active" : ""}" data-guide-category="${escapeHtml(category.id)}">${escapeHtml(category.label)}</button>`,
    ).join("");
  }

  const grid = qs("#guideGrid");
  if (!grid) return;
  const query = state.guideQuery.trim().toLowerCase();
  const guides = GUIDES.filter((guide) => {
    const inCategory = state.guideCategory === "all" || guide.category === state.guideCategory;
    if (!inCategory) return false;
    if (!query) return true;
    const haystack = [guide.title, guide.summary, guide.category, ...guide.steps, guide.tip]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  qs("#guideEmpty")?.classList.toggle("hidden", guides.length > 0);
  grid.innerHTML = guides
    .map(
      (guide) => `<button type="button" class="guide-card" data-guide-id="${escapeHtml(guide.id)}">
        <span class="guide-icon">${icon(guide.icon, "h-4 w-4")}</span>
        <h3>${escapeHtml(guide.title)}</h3>
        <p>${escapeHtml(guide.summary)}</p>
        <div class="guide-meta">
          <span>${icon("clock", "h-3 w-3")} ${escapeHtml(guide.duration)}</span>
          <span>${escapeHtml(GUIDE_CATEGORIES.find((category) => category.id === guide.category)?.label || "Guide")}</span>
          <span class="ml-auto">${icon("arrow-right", "h-3 w-3")}</span>
        </div>
      </button>`,
    )
    .join("");
}

function openGuide(guideId) {
  const guide = GUIDES.find((item) => item.id === guideId);
  if (!guide) return;
  const modal = openModal({
    title: guide.title,
    subtitle: `${GUIDE_CATEGORIES.find((category) => category.id === guide.category)?.label || "Guide"} · ${guide.duration}`,
    body: `<p class="text-[0.84rem] leading-6 text-slate-300">${escapeHtml(guide.summary)}</p>
      <div class="guide-steps mt-4">
        ${guide.steps.map((step) => `<div class="guide-step"><p>${escapeHtml(step)}</p></div>`).join("")}
      </div>
      <div class="mt-4 rounded-xl border border-cyan-400/20 bg-cyan-500/[0.07] p-3">
        <p class="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-cyan-200">Good to know</p>
        <p class="mt-1 text-[0.78rem] leading-6 text-cyan-50/80">${escapeHtml(guide.tip)}</p>
      </div>`,
    footer: `<button type="button" class="btn btn-secondary" data-modal-close>Close</button>
      <button type="button" class="btn btn-primary" data-guide-support>Ask a technician</button>`,
    size: "lg",
  });
  modal.root.querySelector("[data-guide-support]")?.addEventListener("click", () => {
    modal.close();
    goTo("support");
  });
}

function renderVideos() {
  const grid = qs("#videoGrid");
  if (!grid) return;
  grid.innerHTML = VIDEOS.map(
    (video) => `<button type="button" class="video-card" data-video-id="${escapeHtml(video.id)}">
      <div class="video-thumb">
        <img src="https://i.ytimg.com/vi/${encodeURIComponent(video.id)}/hqdefault.jpg" alt="" loading="lazy" referrerpolicy="no-referrer" />
        <span class="video-play"><span>${icon("play", "h-4 w-4")}</span></span>
      </div>
      <div class="video-body">
        <h3>${escapeHtml(video.title)}</h3>
        <p>${escapeHtml(video.source)} · ${escapeHtml(video.category)} · ${escapeHtml(video.length)}</p>
      </div>
    </button>`,
  ).join("");
  qsa("img", grid).forEach((image) => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });
}

function openVideo(videoId) {
  const video = VIDEOS.find((item) => item.id === videoId);
  if (!video) return;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0&modestbranding=1`;
  openModal({
    title: video.title,
    subtitle: `${video.source} · ${video.length}`,
    body: `<div style="position:relative;padding-top:56.25%;border-radius:14px;overflow:hidden;background:#000">
        <iframe
          src="${embedUrl}"
          title="${escapeHtml(video.title)}"
          style="position:absolute;inset:0;width:100%;height:100%;border:0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
      <p class="help-text mt-3">
        Video tutorials stream from YouTube. If you are offline, the written guide is still available.
      </p>`,
    footer: `<a class="btn btn-secondary" href="https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}" target="_blank" rel="noopener noreferrer">${icon("external-link", "h-4 w-4")} Open on YouTube</a>
      <button type="button" class="btn btn-primary" data-modal-close>Close</button>`,
    size: "lg",
  });
}

function renderFaqs() {
  const list = qs("#faqList");
  if (!list) return;
  list.innerHTML = FAQS.map(
    (faq, index) => `<details class="faq-item" ${index === 0 ? "open" : ""}>
      <summary>${escapeHtml(faq.question)} ${icon("chevron-down", "h-4 w-4")}</summary>
      <p class="faq-answer">${escapeHtml(faq.answer)}</p>
    </details>`,
  ).join("");
}

/* ==========================================================================
   Profile and account UI
   ========================================================================== */

function renderProfile() {
  if (!state.user) return;
  const name = state.displayName || displayNameFor(state.user, state.profile);
  const email = state.user.email || "";
  const isGuest = state.user.isAnonymous;
  const isAdmin = state.profile?.role === "admin";

  setText("#profileName", name);
  setText("#profileEmail", isGuest ? "Guest session · this device only" : email || "No email on file");
  setText("#profileAvatar", getInitials(name || email, "A"));
  setText("#headerInitials", getInitials(name || email, "A"));
  setText("#profileRoleBadge", isAdmin ? "Administrator" : isGuest ? "Guest" : "Verified account");
  qs("#profileRoleBadge")?.classList.toggle("badge-brand", isAdmin);
  qs("#profileRoleBadge")?.classList.toggle("badge-resolved", !isAdmin && !isGuest);
  qs("#profileRoleBadge")?.classList.toggle("badge-neutral", isGuest);

  const since = toDate(state.profile?.createdAt);
  setText("#profileSince", since ? `Member since ${formatDate(since, { dateStyle: "medium" })}` : "Member since recently");
  qs("#guestUpgradeCard")?.classList.toggle("hidden", !isGuest);
  qs("#adminLinkWrap")?.classList.toggle("hidden", !isAdmin);
  if (isGuest) {
    const nameField = qs("#upgradeName");
    if (nameField && !nameField.value) nameField.value = name;
  }

  setText(
    "#installStatusText",
    isStandalone()
      ? "Aide is installed and running in standalone mode."
      : IS_IOS
        ? "On iPhone: Safari → Share → Add to Home Screen."
        : "Install from your browser menu for a full-screen experience.",
  );
  renderTelemetryToggles();
  refreshPushUI();
  updateInstallUI();
}

/* ==========================================================================
   Event wiring
   ========================================================================== */

function bindStaticEvents() {
  document.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      event.preventDefault();
      goTo(nav.dataset.nav);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action) {
      event.preventDefault();
      handleAction(action.dataset.action, action);
      return;
    }

    const guideButton = event.target.closest("[data-guide-id]");
    if (guideButton) {
      openGuide(guideButton.dataset.guideId);
      return;
    }

    const videoButton = event.target.closest("[data-video-id]");
    if (videoButton) {
      openVideo(videoButton.dataset.videoId);
      return;
    }

    const categoryButton = event.target.closest("[data-guide-category]");
    if (categoryButton) {
      state.guideCategory = categoryButton.dataset.guideCategory;
      renderGuides();
      return;
    }

    const filterButton = event.target.closest("[data-ticket-filter]");
    if (filterButton) {
      state.ticketFilter = filterButton.dataset.ticketFilter;
      qsa("[data-ticket-filter]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.ticketFilter === state.ticketFilter);
      });
      renderTickets();
      return;
    }

    const removeFile = event.target.closest("[data-remove-file]");
    if (removeFile) {
      removeTicketFile(Number(removeFile.dataset.removeFile));
      return;
    }

    const ackButton = event.target.closest("[data-ack-alert]");
    if (ackButton) {
      const alert = visibleAlerts().find((item) => item.id === ackButton.dataset.ackAlert);
      if (alert) acknowledgeAlert(alert, { notify: true });
      return;
    }

    const openAlert = event.target.closest("[data-open-alert]");
    if (openAlert) {
      openAlertById(openAlert.dataset.openAlert);
      return;
    }

    const ticketButton = event.target.closest("[data-ticket-id]");
    if (ticketButton) {
      openTicket(ticketButton.dataset.ticketId);
    }
  });

  qsa("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });
  qs("#authForm")?.addEventListener("submit", submitAuthForm);
  qs("#guestBtn")?.addEventListener("click", continueAsGuest);
  qs("#resetPasswordBtn")?.addEventListener("click", resetPassword);
  qs("#upgradeForm")?.addEventListener("submit", upgradeGuestAccount);

  qs("#ticketForm")?.addEventListener("submit", submitTicket);
  qs("#ticketDescription")?.addEventListener("input", (event) => {
    setText("#descriptionCount", String(event.target.value.length));
  });
  qs("#ticketFiles")?.addEventListener("change", (event) => {
    handleTicketFiles(event.target.files);
    event.target.value = "";
  });
  const dropzone = qs("#ticketDropzone");
  if (dropzone) {
    ["dragenter", "dragover"].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragover");
      }),
    );
    ["dragleave", "drop"].forEach((type) =>
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragover");
      }),
    );
    dropzone.addEventListener("drop", (event) => handleTicketFiles(event.dataTransfer?.files));
  }

  qs("#guideSearch")?.addEventListener(
    "input",
    debounce((event) => {
      state.guideQuery = event.target.value;
      renderGuides();
    }, 120),
  );

  qsa(".js-telemetry-toggle").forEach((toggle) => {
    toggle.addEventListener("change", () => setTelemetryEnabled(toggle.checked));
  });

  qs("#alertBackdrop")?.addEventListener("click", () => closeAlertModal());
  qs("#alertCloseBtn")?.addEventListener("click", () => closeAlertModal());
  qs("#alertAckBtn")?.addEventListener("click", () => closeAlertModal({ ack: true, notify: true }));
  qs("#alertViewAllBtn")?.addEventListener("click", () => {
    closeAlertModal();
    goTo("alerts");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.currentAlert) closeAlertModal();
  });

  window.addEventListener("online", () => {
    updateNetworkUI();
    showToast("Back online. Syncing your data…", "success", 3500);
    if (state.user) pushTelemetry();
  });
  window.addEventListener("offline", () => {
    updateNetworkUI();
    showToast("You are offline. Aide will keep your work and sync when you reconnect.", "warning", 5000);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !state.user) return;
    updateNetworkUI();
    if (!state.lastSyncAt || Date.now() - state.lastSyncAt.getTime() > 30_000) pushTelemetry();
  });

  setInterval(() => {
    tickClock();
    updateSyncUI();
  }, 30_000);
}

async function handleAction(action, button) {
  switch (action) {
    case "refresh-telemetry":
      setBusy(button, true);
      await pushTelemetry({ notify: true });
      setBusy(button, false);
      break;
    case "enable-push":
      setBusy(button, true);
      await enablePush();
      setBusy(button, false);
      break;
    case "test-push":
      setBusy(button, true);
      await sendTestNotification();
      setBusy(button, false);
      break;
    case "install-app":
      await installApp();
      break;
    case "sign-out":
      await handleSignOut();
      break;
    case "acknowledge-all":
      await acknowledgeAllAlerts();
      break;
    default:
      break;
  }
}

/* ==========================================================================
   Session lifecycle and small utilities
   ========================================================================== */

function teardownSession() {
  state.alertsUnsub?.();
  state.alertsUnsub = null;
  state.ticketsUnsub?.();
  state.ticketsUnsub = null;
  state.messageUnsub?.();
  state.messageUnsub = null;
  clearInterval(state.telemetryTimer);
  state.telemetryTimer = null;

  try {
    state.ambientSensor?.stop();
  } catch {
    /* Sensor may already be stopped. */
  }
  state.ambientSensor = null;

  state.user = null;
  state.profile = null;
  state.displayName = "";
  state.appReady = false;
  state.tickets = [];
  state.ticketsReady = false;
  state.ticketStatuses.clear();
  state.alerts = [];
  state.alertQueue = [];
  state.currentAlert = null;
  state.ticketFiles = [];
  state.lastContext = null;
  state.lastSyncAt = null;
  state.syncFailed = false;
  state.fcmToken = null;
  state.messaging = null;
  state.batteryListenersAttached = false;
  state.batteryManager = null;
  state.lastLocation = null;
  state.ambientLux = null;

  qs("#alertOverlay")?.classList.add("hidden");
  document.body.style.overflow = "";
  qs("#ticketFileList") && (qs("#ticketFileList").innerHTML = "");
  hideFormError("#ticketFormError");
  hideFormError("#upgradeError");
}

function setText(selector, value) {
  const node = typeof selector === "string" ? qs(selector) : selector;
  if (!node) return;
  const text = String(value ?? "");
  if (node.textContent !== text) node.textContent = text;
}

function setBusy(button, busy) {
  if (!button) return;
  button.classList.toggle("is-loading", busy);
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
}

function showFormError(selector, message) {
  const node = qs(selector);
  if (!node) return;
  node.innerHTML = `${icon("alert-circle", "h-4 w-4 flex-none")}<span>${escapeHtml(message)}</span>`;
  node.classList.remove("hidden");
}

function hideFormError(selector) {
  const node = qs(selector);
  if (!node) return;
  node.classList.add("hidden");
  node.textContent = "";
}

function readStoredBoolean(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key, value) {
  try {
    localStorage.setItem(key, String(Boolean(value)));
  } catch {
    /* Ignore storage failures. */
  }
}

function withTimeout(promise, ms, fallback) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (fallback === undefined) reject(new Error("The operation timed out."));
      else resolve(fallback);
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/* Start the application. */
init().catch((error) => {
  console.error("[Aide] Fatal initialisation error.", error);
  hideBoot();
  showToast("Aide could not start. Reload the page or check your connection.", "error", 8000);
});
