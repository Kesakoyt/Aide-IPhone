//
//  VueFavoris.swift
//  AideiPhone
//
//  Fiches mises en favori, stockées localement sur l'appareil.
//

import SwiftUI

struct VueFavoris: View {
    @Environment(ServiceAide.self) private var service
    @Environment(ServiceFavoris.self) private var favoris

    private var fichesFavoris: [Fiche] {
        service.fiches.filter { favoris.estFavori($0) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if fichesFavoris.isEmpty {
                    ContentUnavailableView {
                        Label("Aucun favori", systemImage: "star")
                    } description: {
                        Text("Touchez l’étoile en haut d’une fiche pour la retrouver ici, même hors connexion.")
                    }
                } else {
                    List(fichesFavoris) { fiche in
                        NavigationLink(value: fiche) {
                            VueLigneFiche(fiche: fiche)
                        }
                    }
                    .listStyle(.insetGrouped)
                    .navigationDestination(for: Fiche.self) { fiche in
                        VueFiche(fiche: fiche)
                    }
                }
            }
            .navigationTitle("Favoris")
        }
    }
}

#Preview {
    VueFavoris()
        .environment(ServiceAide())
        .environment(ServiceFavoris())
}
