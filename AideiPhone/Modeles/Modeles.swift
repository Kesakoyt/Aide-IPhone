//
//  Modeles.swift
//  AideiPhone
//
//  Modèles de données partagés entre Firestore et le contenu embarqué.
//  Les noms de champs correspondent exactement aux champs Firestore.
//

import Foundation

/// Une catégorie regroupe des fiches autour d'un thème (« Photos et caméra », …).
struct Categorie: Identifiable, Codable, Hashable {
    let id: String
    let titre: String
    let resume: String
    /// Nom du symbole SF utilisé pour illustrer la catégorie (ex. « camera »).
    let symbole: String
    /// Couleur d'accent au format hexadécimal (ex. « #0A84FF »).
    let couleur: String
    let ordre: Int
}

/// Une fiche d'aide : un article court et pratique.
struct Fiche: Identifiable, Codable, Hashable {
    let id: String
    let titre: String
    let resume: String
    /// Corps de la fiche au format Markdown (titres, listes, gras…).
    let contenu: String
    let categorieID: String
    /// Mots supplémentaires pris en compte par la recherche.
    let motsCles: [String]
    let ordre: Int
}

/// Structure du fichier `donnees_exemple.json` embarqué dans l'application.
struct ContenuIntegral: Codable {
    let categories: [Categorie]
    let fiches: [Fiche]
}
