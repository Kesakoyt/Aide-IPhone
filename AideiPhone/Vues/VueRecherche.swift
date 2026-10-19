//
//  VueRecherche.swift
//  AideiPhone
//
//  Recherche globale dans toutes les fiches, avec résultats groupés
//  par catégorie. Recherche insensible à la casse et aux accents.
//

import SwiftUI

struct VueRecherche: View {
    @Environment(ServiceAide.self) private var service
    @State private var texteRecherche = ""

    /// Un groupe de résultats rattaché à une catégorie.
    private struct Groupe: Identifiable {
        let categorie: Categorie
        let fiches: [Fiche]
        var id: String { categorie.id }
    }

    private var resultats: [Fiche] {
        service.rechercher(texteRecherche)
    }

    /// Résultats groupés par catégorie, dans l'ordre d'affichage.
    private var groupes: [Groupe] {
        service.categories.compactMap { categorie in
            let fiches = resultats.filter { $0.categorieID == categorie.id }
            return fiches.isEmpty ? nil : Groupe(categorie: categorie, fiches: fiches)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(groupes) { groupe in
                    Section(groupe.categorie.titre) {
                        ForEach(groupe.fiches) { fiche in
                            NavigationLink(value: fiche) {
                                VueLigneFiche(fiche: fiche)
                            }
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .overlay {
                if resultats.isEmpty {
                    ContentUnavailableView.search(text: texteRecherche)
                }
            }
            .navigationTitle("Recherche")
            .navigationDestination(for: Fiche.self) { fiche in
                VueFiche(fiche: fiche)
            }
            .searchable(
                text: $texteRecherche,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Rechercher une fiche"
            )
        }
    }
}

#Preview {
    VueRecherche()
        .environment(ServiceAide())
        .environment(ServiceFavoris())
}
