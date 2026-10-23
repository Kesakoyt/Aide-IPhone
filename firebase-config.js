/**
 * Aide iPhone — shared Firebase bootstrap.
 *
 * The same configuration powers the client PWA and the admin panel.
 * SDK version is pinned so the app shell and service worker stay in sync.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getFunctions } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getMessaging, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBjGryNQb8d_W9F1Wi638umLv9pdL6cBiw",
  authDomain: "aide-iphone.firebaseapp.com",
  projectId: "aide-iphone",
  storageBucket: "aide-iphone.firebasestorage.app",
  messagingSenderId: "146620382102",
  appId: "1:146620382102:web:9c80876744ab90f8123bb7",
};

/**
 * Web Push certificate (VAPID) public key.
 *
 * Generate one in Firebase Console → Project settings → Cloud Messaging →
 * Web configuration → Web Push certificates, then paste the public key here.
 * The app still works without it; only FCM token registration is disabled.
 */
export const VAPID_PUBLIC_KEY = "";

export const APP_VERSION = "1.1.0";
export const TELEMETRY_INTERVAL_MS = 60_000;
export const ONLINE_WINDOW_MS = 5 * 60_000;
export const FUNCTIONS_REGION = "us-central1";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Firestore with IndexedDB persistence: telemetry, alerts and ticket writes
 * survive short connection drops and are replayed when the device is online.
 * Falls back to the in-memory cache on browsers that do not support it.
 */
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (error) {
  console.warn("[Aide] Persistent Firestore cache unavailable, using default cache.", error);
  firestore = getFirestore(app);
}
export const db = firestore;
export const storage = getStorage(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

/** Returns a Messaging instance when the browser supports it, otherwise null. */
export async function getMessagingClient() {
  try {
    if (!(await isSupported())) return null;
    return getMessaging(app);
  } catch (error) {
    console.warn("[Aide] Firebase Messaging is unavailable.", error);
    return null;
  }
}
