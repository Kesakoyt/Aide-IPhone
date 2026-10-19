//
//  VueCategorie.swift
//  AideiPhone
//
//  Liste des fiches d'une catégorie.
//

import SwiftUI

struct VueCategorie: View {
    let categorie: Categorie
    @Environment(ServiceAide.self) private var service

    private var fiches: [Fiche] {
        service.fiches(de: categorie)
    }

    var body: some View {
        List(fiches) { fiche in
            NavigationLink(value: fiche) {
                VueLigneFiche(fiche: fiche)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(categorie.titre)
        .navigationBarTitleDisplayMode(.large)
        .overlay {
            if fiches.isEmpty {
                ContentUnavailableView(
                    "Aucune fiche",
                    systemImage: "doc.text",
                    description: Text("Des fiches seront bientôt ajoutées dans cette catégorie.")
                )
            }
        }
    }
}
