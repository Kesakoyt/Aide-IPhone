//
//  ServiceAide.swift
//  AideiPhone
//
//  Charge les catégories et les fiches depuis Firestore.
//  Si `GoogleService-Info.plist` est absent du bundle (projet Firebase
//  pas encore configuré), ou si le chargement échoue, l'application
//  utilise automatiquement le contenu embarqué `donnees_exemple.json`.
//

import Foundation
import SwiftUI
import FirebaseCore
import FirebaseFirestore

@MainActor
@Observable
final class ServiceAide {

    enum Etat: Equatable {
        case chargement
        case pret
        case echec(String)
    }

    private(set) var etat: Etat = .chargement
    private(set) var categories: [Categorie] = []
    private(set) var fiches: [Fiche] = []

    /// Vrai quand l'affichage repose sur le contenu embarqué (hors ligne).
    private(set) var contenuHorsLigne = false

    /// Vrai si `GoogleService-Info.plist` est présent et que Firebase a démarré.
    let firebaseDisponible: Bool

    private var base: Firestore?

    init() {
        guard let chemin = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
              FileManager.default.fileExists(atPath: chemin)
        else {
            firebaseDisponible = false
            return
        }
        FirebaseApp.configure()
        base = Firestore.firestore()
        firebaseDisponible = true
    }

    // MARK: - Chargement

    /// Charge le contenu depuis Firestore, ou à défaut depuis le bundle.
    func charger() async {
        etat = .chargement

        guard firebaseDisponible, let base else {
            chargerContenuEmbarque()
            return
        }

        do {
            let snapshotCategories = try await base
                .collection("categories")
                .order(by: "ordre")
                .getDocuments()
            let snapshotFiches = try await base
                .collection("fiches")
                .order(by: "ordre")
                .getDocuments()

            let categoriesChargees = snapshotCategories.documents
                .compactMap { try? $0.data(as: Categorie.self) }
            let fichesChargees = snapshotFiches.documents
                .compactMap { try? $0.data(as: Fiche.self) }

            guard !categoriesChargees.isEmpty, !fichesChargees.isEmpty else {
                // Firestore est joignable mais vide : on se rabat sur le bundle.
                chargerContenuEmbarque()
                return
            }

            categories = categoriesChargees
            fiches = fichesChargees
            contenuHorsLigne = false
            etat = .pret
        } catch {
            etat = .echec(messageFR(pour: error))
        }
    }

    /// Recharge depuis le contenu embarqué (bouton « hors ligne »).
    func chargerContenuEmbarque() {
        guard let url = Bundle.main.url(forResource: "donnees_exemple", withExtension: "json") else {
            etat = .echec("Le contenu embarqué est introuvable dans l'application.")
            return
        }
        do {
            let donnees = try Data(contentsOf: url)
            let contenu = try JSONDecoder().decode(ContenuIntegral.self, from: donnees)
            categories = contenu.categories.sorted { $0.ordre < $1.ordre }
            fiches = contenu.fiches.sorted { $0.ordre < $1.ordre }
            contenuHorsLigne = true
            etat = .pret
        } catch {
            etat = .echec("Impossible de lire le contenu embarqué.")
        }
    }

    // MARK: - Requêtes utiles aux vues

    func fiches(de categorie: Categorie) -> [Fiche] {
        fiches
            .filter { $0.categorieID == categorie.id }
            .sorted { $0.ordre < $1.ordre }
    }

    func categorie(de fiche: Fiche) -> Categorie? {
        categories.first { $0.id == fiche.categorieID }
    }

    /// Recherche insensible à la casse et aux accents, dans les titres,
    /// résumés, contenus et mots-clés.
    func rechercher(_ texte: String) -> [Fiche] {
        let requete = normaliser(texte)
        guard !requete.isEmpty else { return fiches }

        return fiches
            .filter { fiche in
                normaliser(fiche.titre).contains(requete)
                    || normaliser(fiche.resume).contains(requete)
                    || normaliser(fiche.contenu).contains(requete)
                    || fiche.motsCles.contains { normaliser($0).contains(requete) }
            }
            .sorted { ficheA, ficheB in
                // Les fiches dont le titre correspond passent en premier.
                let pertinenceA = normaliser(ficheA.titre).contains(requete) ? 0 : 1
                let pertinenceB = normaliser(ficheB.titre).contains(requete) ? 0 : 1
                if pertinenceA != pertinenceB { return pertinenceA < pertinenceB }
                return ficheA.ordre < ficheB.ordre
            }
    }

    private func normaliser(_ texte: String) -> String {
        texte.folding(options: [.diacriticInsensitive, .caseInsensitive],
                      locale: Locale(identifier: "fr_FR"))
    }

    // MARK: - Messages d'erreur en français

    private func messageFR(pour error: Error) -> String {
        let nsErreur = error as NSError
        if nsErreur.domain == FirestoreErrorDomain,
           let code = FirestoreErrorCode(rawValue: nsErreur.code) {
            switch code {
            case .unavailable, .deadlineExceeded:
                return "Connexion impossible. Vérifiez votre accès à Internet, puis réessayez."
            case .permissionDenied:
                return "Accès refusé par Firestore. Vérifiez les règles de sécurité de votre base."
            case .notFound:
                return "La base de données est introuvable. Vérifiez la configuration de Firebase."
            default:
                break
            }
        }
        return "Le contenu n'a pas pu être chargé. Vous pouvez réessayer ou utiliser le contenu hors ligne."
    }
}
