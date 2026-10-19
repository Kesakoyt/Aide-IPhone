//
//  AideiPhoneApp.swift
//  AideiPhone
//
//  Point d'entrée de l'application « Aide iPhone ».
//  Fiches d'aide en français pour prendre en main un iPhone,
//  alimentées par Firebase Firestore (avec contenu embarqué en secours).
//

import SwiftUI

@main
struct AideiPhoneApp: App {
    @State private var service = ServiceAide()
    @State private var favoris = ServiceFavoris()

    var body: some Scene {
        WindowGroup {
            VueContenu()
                .environment(service)
                .environment(favoris)
                .task {
                    await service.charger()
                }
        }
    }
}
