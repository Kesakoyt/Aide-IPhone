//
//  VueContenu.swift
//  AideiPhone
//
//  Conteneur principal : trois onglets, conformes aux recommandations
//  d'interface d'Apple (libellés explicites + icônes SF Symbols).
//

import SwiftUI

struct VueContenu: View {
    var body: some View {
        TabView {
            VueAccueil()
                .tabItem { Label("Accueil", systemImage: "house.fill") }

            VueRecherche()
                .tabItem { Label("Recherche", systemImage: "magnifyingglass") }

            VueFavoris()
                .tabItem { Label("Favoris", systemImage: "star.fill") }
        }
    }
}

#Preview {
    VueContenu()
        .environment(ServiceAide())
        .environment(ServiceFavoris())
}
