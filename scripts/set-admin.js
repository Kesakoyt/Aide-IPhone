#!/usr/bin/env node
/**
 * Grants or revokes the administrator role for an existing Firebase Auth user.
 *
 * Usage:
 *   node set-admin.js admin@example.com
 *   node set-admin.js admin@example.com --revoke
 *   node set-admin.js new-admin@example.com "InitialPassword123!" --create
 *
 * Authentication:
 *   Uses Application Default Credentials. Either run
 *     gcloud auth application-default login
 *   or set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON key with
 *   Firebase Auth and Firestore access.
 *
 * Never commit a service-account key to this repository.
 */

const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

const args = process.argv.slice(2);
const email = (args.find((argument) => !argument.startsWith("--")) || "").trim().toLowerCase();
const password = args[1] && !args[1].startsWith("--") ? args[1] : "";
const revoke = args.includes("--revoke");
const create = args.includes("--create");
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "aide-iphone";

if (!email) {
  console.error("Usage: node set-admin.js <email> [password] [--create] [--revoke]");
  process.exit(1);
}

admin.initializeApp({ projectId });
const auth = admin.auth();
const db = admin.firestore();

async function main() {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch (error) {
    if (error.code !== "auth/user-not-found" || !create) {
      throw error;
    }
    if (!password || password.length < 8) {
      throw new Error(
        "User does not exist. Pass a password of at least 8 characters with --create, or create the user in the Firebase Console first.",
      );
    }
    user = await auth.createUser({ email, password, displayName: email.split("@")[0] });
    console.log(`Created Firebase Auth user: ${user.uid}`);
  }

  const role = revoke ? "user" : "admin";
  const reference = db.collection("users").doc(user.uid);
  const snapshot = await reference.get();
  const profile = {
    uid: user.uid,
    email: user.email || email,
    displayName: user.displayName || (snapshot.exists ? snapshot.data().displayName : email.split("@")[0]),
    role,
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (!snapshot.exists) {
    profile.createdAt = FieldValue.serverTimestamp();
    profile.lastLogin = null;
    profile.authProvider = user.providerData?.[0]?.providerId || "password";
    profile.photoURL = user.photoURL || "";
    profile.phone = user.phoneNumber || "";
  }

  await reference.set(profile, { merge: true });

  const claims = { ...(user.customClaims || {}), admin: role === "admin", role };
  await auth.setCustomUserClaims(user.uid, claims);

  await db.collection("auditLogs").add({
    action: revoke ? "admin_revoke" : "admin_grant",
    actorId: "bootstrap-script",
    actorName: "Administration bootstrap",
    actorEmail: "",
    targetType: "user",
    targetId: user.uid,
    details: `${revoke ? "Revoked" : "Granted"} administrator access for ${email}`,
    createdAt: FieldValue.serverTimestamp(),
    appVersion: "script",
  });

  console.log("");
  console.log(`Project:  ${projectId}`);
  console.log(`User:     ${email}`);
  console.log(`UID:      ${user.uid}`);
  console.log(`Role:     ${role}`);
  console.log(`Claims:   ${JSON.stringify(claims)}`);
  console.log("");
  console.log("The user must sign out and sign back in for a refreshed ID token.");
  console.log("Then open admin.html on the Firebase Hosting domain.");
}

main().catch((error) => {
  console.error("Could not update administrator access:", error.message || error);
  process.exitCode = 1;
});
