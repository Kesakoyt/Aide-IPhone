/**
 * Aide iPhone — Cloud Functions (v2, us-central1).
 *
 * Why server-side push?
 *   Sending FCM messages requires a privileged credential. It cannot be done
 *   safely from the browser, so the admin panel writes an alert document and
 *   these functions deliver it to the registered device tokens.
 *
 * Functions:
 *   sendPush        Callable. Admin-only resend / test push.
 *   onAlertCreated  Firestore trigger. Automatic push when autoPush === true.
 *   onTicketUpdated Firestore trigger. Notifies a user when a technician
 *                   changes the status or replies on their ticket.
 */

const { setGlobalOptions } = require("firebase-functions/v2");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

admin.initializeApp();
const db = getFirestore();
const messaging = getMessaging();

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const APP_URL = process.env.APP_URL || "https://kesakoyt.github.io/Aide-IPhone";
const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
  "messaging/mismatched-credential",
]);

const STATUS_LABELS = {
  pending: "pending",
  in_progress: "in progress",
  resolved: "resolved",
};

/* ==========================================================================
   Helpers
   ========================================================================== */

function chunk(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

function clip(value, length) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, Math.max(0, length - 1))}…` : text;
}

async function assertAdmin(request) {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in with a staff account first.");
  }
  const snapshot = await db.collection("users").doc(request.auth.uid).get();
  if (!snapshot.exists || snapshot.data().role !== "admin") {
    throw new HttpsError("permission-denied", "Administrator access is required.");
  }
  return { uid: request.auth.uid, profile: snapshot.data() };
}

function isActiveToken(data) {
  return data && data.active === true && typeof data.token === "string" && data.token.length > 20;
}

async function tokensForEveryone() {
  const snapshot = await db.collection("fcmTokens").where("active", "==", true).limit(2000).get();
  return dedupeTokens(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
}

async function tokensForUids(uids) {
  const unique = [...new Set(uids.filter((uid) => typeof uid === "string" && uid))];
  const documents = [];
  for (const group of chunk(unique, 30)) {
    if (!group.length) continue;
    const snapshot = await db.collection("fcmTokens").where("uid", "in", group).limit(1000).get();
    snapshot.docs.forEach((document) => {
      documents.push({ id: document.id, ...document.data() });
    });
  }
  return dedupeTokens(documents);
}

async function tokensForUser(uid) {
  if (!uid) return [];
  const snapshot = await db.collection("fcmTokens").where("uid", "==", uid).limit(500).get();
  return dedupeTokens(snapshot.docs.map((document) => ({ id: document.id, ...document.data() })));
}

function dedupeTokens(documents) {
  const seen = new Set();
  const output = [];
  for (const document of documents) {
    if (!isActiveToken(document)) continue;
    if (seen.has(document.token)) continue;
    seen.add(document.token);
    output.push(document);
  }
  return output;
}

async function tokenDocsForAlert(alert) {
  if (alert.audience === "users") {
    const targets = Array.isArray(alert.targetUids) ? alert.targetUids : [];
    return targets.length ? tokensForUids(targets) : [];
  }
  return tokensForEveryone();
}

function alertWebLink(alertId) {
  return `${APP_URL.replace(/\/$/, "")}/index.html?view=alerts&alert=${encodeURIComponent(alertId)}`;
}

/**
 * Sends a data-only FCM message. The service worker renders the notification,
 * which keeps copy, deep links and critical styling under application control.
 */
async function deliver({ title, body, data = {}, tokens }) {
  const valid = tokens.filter(isActiveToken);
  if (!valid.length) {
    return { sentCount: 0, failedCount: 0, invalidCount: 0, deviceCount: 0 };
  }

  const payloadData = Object.fromEntries(
    Object.entries({
      title: clip(title, 120),
      body: clip(body, 400),
      type: "alert",
      ...data,
    }).map(([key, value]) => [key, String(value ?? "")]),
  );

  const isCritical = payloadData.severity === "critical";
  let sentCount = 0;
  let failedCount = 0;
  const invalidDocuments = [];

  for (const group of chunk(valid, 500)) {
    const response = await messaging.sendEachForMulticast({
      tokens: group.map((document) => document.token),
      data: payloadData,
      webpush: {
        headers: {
          Urgency: isCritical ? "high" : "normal",
          TTL: "86400",
        },
        fcmOptions: { link: `${APP_URL.replace(/\/$/, "")}/index.html?view=alerts` },
      },
    });

    sentCount += response.successCount;
    failedCount += response.failureCount;

    response.responses.forEach((result, index) => {
      if (result.success) return;
      const code = result.error?.code || "";
      if (INVALID_TOKEN_CODES.has(code)) {
        invalidDocuments.push(group[index]);
      }
      logger.warn("Push delivery failed.", {
        code,
        message: result.error?.message,
        uid: group[index]?.uid,
      });
    });
  }

  if (invalidDocuments.length) {
    await Promise.allSettled(
      invalidDocuments.map((document) =>
        db.collection("fcmTokens").doc(document.id).set(
          {
            active: false,
            updatedAt: FieldValue.serverTimestamp(),
            disabledReason: "invalid-token",
          },
          { merge: true },
        ),
      ),
    );
  }

  return {
    sentCount,
    failedCount,
    invalidCount: invalidDocuments.length,
    deviceCount: valid.length,
  };
}

function pushSummary(result, source, actor) {
  return {
    status:
      result.deviceCount === 0
        ? "no-devices"
        : result.failedCount === 0
          ? "sent"
          : result.sentCount > 0
            ? "partial"
            : "failed",
    sentCount: result.sentCount,
    failedCount: result.failedCount,
    invalidCount: result.invalidCount,
    deviceCount: result.deviceCount,
    sentAt: FieldValue.serverTimestamp(),
    source,
    sentBy: actor || "cloud-function",
  };
}

async function deliverAlertDocument(alertId, alert, source, actor) {
  const tokens = await tokenDocsForAlert(alert);
  const result = await deliver({
    title: alert.title || "Aide iPhone",
    body: clip(alert.message || "A new notice is available in the app.", 180),
    data: {
      alertId,
      severity: alert.severity || "info",
      url: `./index.html?view=alerts&alert=${encodeURIComponent(alertId)}`,
    },
    tokens,
  });
  await db
    .collection("alerts")
    .doc(alertId)
    .set({ pushSummary: pushSummary(result, source, actor) }, { merge: true });
  return result;
}

/* ==========================================================================
   Callable: resend / test push
   ========================================================================== */

exports.sendPush = onCall({ cors: true, timeoutSeconds: 60, memory: "256MiB" }, async (request) => {
  const { uid, profile } = await assertAdmin(request);
  const input = request.data || {};

  if (input.test === true) {
    const tokens = await tokensForUser(uid);
    const result = await deliver({
      title: "Aide iPhone — test notification",
      body: "Push delivery is working. This message was sent from the staff console.",
      data: {
        type: "test",
        severity: "info",
        url: "./index.html?view=alerts",
      },
      tokens,
    });
    logger.info("Admin test push completed.", { uid, ...result });
    return { ok: true, test: true, ...result };
  }

  const alertId = typeof input.alertId === "string" ? input.alertId.trim() : "";
  if (!alertId) {
    throw new HttpsError("invalid-argument", "Provide an alertId or set test to true.");
  }

  const reference = db.collection("alerts").doc(alertId);
  const snapshot = await reference.get();
  if (!snapshot.exists) {
    throw new HttpsError("not-found", "That broadcast no longer exists.");
  }
  const alert = snapshot.data();
  if (alert.active === false && input.force !== true) {
    throw new HttpsError("failed-precondition", "Activate the broadcast before sending it.");
  }

  // Avoid a duplicate delivery when the onCreate trigger has already sent it.
  if (input.force !== true && alert.pushSummary?.sentAt) {
    return { ok: true, skipped: true, ...alert.pushSummary };
  }

  const result = await deliverAlertDocument(alertId, alert, "manual", profile.displayName || uid);
  logger.info("Admin push requested.", { uid, alertId, ...result });
  return { ok: true, ...result };
});

/* ==========================================================================
   Trigger: new broadcast
   ========================================================================== */

exports.onAlertCreated = onDocumentCreated(
  { document: "alerts/{alertId}", timeoutSeconds: 60, memory: "256MiB" },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const alert = snapshot.data();
    if (alert.autoPush !== true || alert.active === false) return;

    const expiresAt = alert.expiresAt?.toDate?.();
    if (expiresAt && expiresAt.getTime() <= Date.now()) return;

    try {
      const result = await deliverAlertDocument(event.params.alertId, alert, "trigger", alert.createdBy || "staff");
      logger.info("Automatic alert push completed.", { alertId: event.params.alertId, ...result });
    } catch (error) {
      logger.error("Automatic alert push failed.", {
        alertId: event.params.alertId,
        error: error?.message,
      });
      await snapshot.ref
        .set(
          {
            pushSummary: {
              status: "failed",
              sentCount: 0,
              failedCount: 0,
              invalidCount: 0,
              deviceCount: 0,
              error: clip(error?.message || "Unknown error", 300),
              sentAt: FieldValue.serverTimestamp(),
              source: "trigger",
            },
          },
          { merge: true },
        )
        .catch(() => {});
      // Do not rethrow: retrying a deterministic failure would loop and could
      // send duplicate notifications after a partial success.
    }
  },
);

/* ==========================================================================
   Trigger: ticket status / technician reply
   ========================================================================== */

exports.onTicketUpdated = onDocumentUpdated(
  { document: "tickets/{ticketId}", timeoutSeconds: 60, memory: "256MiB" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after || !after.userId) return;

    const statusChanged = before.status !== after.status;
    const messageChanged =
      (before.technicianMessage || "") !== (after.technicianMessage || "") && Boolean(after.technicianMessage);
    const resolutionChanged =
      (before.resolution || "") !== (after.resolution || "") && Boolean(after.resolution);

    if (!statusChanged && !messageChanged && !resolutionChanged) return;

    const tokens = await tokensForUser(after.userId);
    if (!tokens.length) return;

    const subject = clip(after.subject || "your support request", 80);
    let body;
    if (statusChanged) {
      body = `Ticket “${subject}” is now ${STATUS_LABELS[after.status] || after.status}.`;
    } else if (messageChanged) {
      body = `A technician replied: ${clip(after.technicianMessage, 150)}`;
    } else {
      body = `Your ticket “${subject}” has been resolved. Tap to read the resolution.`;
    }

    try {
      const result = await deliver({
        title: "Aide iPhone — ticket update",
        body,
        data: {
          type: "ticket",
          ticketId: event.params.ticketId,
          severity: after.status === "resolved" ? "info" : "warning",
          url: `./index.html?view=support&ticket=${encodeURIComponent(event.params.ticketId)}`,
        },
        tokens,
      });
      logger.info("Ticket notification sent.", { ticketId: event.params.ticketId, ...result });
    } catch (error) {
      logger.error("Ticket notification failed.", {
        ticketId: event.params.ticketId,
        error: error?.message,
      });
    }
  },
);
