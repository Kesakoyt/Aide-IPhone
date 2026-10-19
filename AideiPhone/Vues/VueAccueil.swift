//
//  VueAccueil.swift
//  AideiPhone
//
//  Écran d'accueil : liste des catégories de fiches, style « réglages »
//  recommandé par les guidelines Apple pour la navigation par thèmes.
//

import SwiftUI

struct VueAccueil: View {
    @Environment(ServiceAide.self) private var service

    var body: some View {
        NavigationStack {
            Group {
                switch service.etat {
                case .chargement:
                    VueChargement()

                case .echec(let message):
                    VueErreur(
                        message: message,
                        actionReessayer: { Task { await service.charger() } },
                        actionHorsLigne: { service.chargerContenuEmbarque() }
                    )

                case .pret:
                    liste
                }
            }
            .navigationTitle("Aide iPhone")
            .navigationDestination(for: Categorie.self) { categorie in
                VueCategorie(categorie: categorie)
            }
            .navigationDestination(for: Fiche.self) { fiche in
                VueFiche(fiche: fiche)
            }
        }
    }

    private var liste: some View {
        List {
            if service.contenuHorsLigne {
                Section {
                    VueBandeauHorsLigne()
                }
            }

            Section("Parcourir par thème") {
                ForEach(service.categories) { categorie in
                    NavigationLink(value: categorie) {
                        VueLigneCategorie(
                            categorie: categorie,
                            nombreDeFiches: service.fiches(de: categorie).count
                        )
                    }
                }
            } footer: {
                Text("\(service.fiches.count) fiches pour prendre en main votre iPhone.")
            }
        }
        .listStyle(.insetGrouped)
        .overlay {
            if service.categories.isEmpty {
                ContentUnavailableView(
                    "Aucune fiche disponible",
                    systemImage: "doc.questionmark",
                    description: Text("Le serveur ne contient pas encore de contenu.")
                )
            }
        }
    }
}

#Preview {
    VueAccueil()
        .environment(ServiceAide())
        .environment(ServiceFavoris())
}
