//
//  ServiceFavoris.swift
//  AideiPhone
//
//  Gère les fiches favorites, persistées localement via UserDefaults.
//

import Foundation

@MainActor
@Observable
final class ServiceFavoris {

    private(set) var identifiants: Set<String>

    private let cle = "favorisFiches"

    init() {
        if let donnees = UserDefaults.standard.data(forKey: cle),
           let ids = try? JSONDecoder().decode(Set<String>.self, from: donnees) {
            identifiants = ids
        } else {
            identifiants = []
        }
    }

    func estFavori(_ fiche: Fiche) -> Bool {
        identifiants.contains(fiche.id)
    }

    func basculer(_ fiche: Fiche) {
        if identifiants.contains(fiche.id) {
            identifiants.remove(fiche.id)
        } else {
            identifiants.insert(fiche.id)
        }
        sauvegarder()
    }

    private func sauvegarder() {
        if let donnees = try? JSONEncoder().encode(identifiants) {
            UserDefaults.standard.set(donnees, forKey: cle)
        }
    }
}
