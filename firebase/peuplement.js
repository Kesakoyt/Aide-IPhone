#!/usr/bin/env node
/**
 * peuplement.js
 * -------------
 * Remplit la base Firestore avec les catégories et les fiches d'aide
 * contenues dans AideiPhone/Ressources/donnees_exemple.json.
 *
 * Prérequis :
 *   1. npm install firebase-admin
 *   2. Télécharger un fichier de compte de service dans la console Firebase
 *      (Paramètres du projet > Comptes de service > Générer une nouvelle clé privée)
 *   3. Lancer :
 *        GOOGLE_APPLICATION_CREDENTIALS=chemin/vers/compte-de-service.json node peuplement.js
 *
 * Le script est idempotent : il écrase les documents aux mêmes identifiants.
 */

const admin = require("firebase-admin");
const cheminContenu = require("path").join(
  __dirname,
  "..",
  "AideiPhone",
  "Ressources",
  "donnees_exemple.json"
);
const contenu = require(cheminContenu);

admin.initializeApp();
const base = admin.firestore();

async function peupler() {
  console.log(`Peuplement de ${contenu.categories.length} catégories et ${contenu.fiches.length} fiches…`);

  // Firestore autorise 500 écritures par lot : ici le contenu tient largement.
  const lot = base.batch();

  for (const categorie of contenu.categories) {
    lot.set(base.collection("categories").doc(categorie.id), categorie);
  }
  for (const fiche of contenu.fiches) {
    lot.set(base.collection("fiches").doc(fiche.id), fiche);
  }

  await lot.commit();
  console.log("Peuplement terminé avec succès.");
}

peupler().catch((erreur) => {
  console.error("Échec du peuplement :", erreur);
  process.exit(1);
});
