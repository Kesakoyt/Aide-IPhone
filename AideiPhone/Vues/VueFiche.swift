//
//  VueFiche.swift
//  AideiPhone
//
//  Lecture d'une fiche : contenu en Markdown, favori et partage.
//

import SwiftUI

struct VueFiche: View {
    let fiche: Fiche

    @Environment(ServiceAide.self) private var service
    @Environment(ServiceFavoris.self) private var favoris

    private var estFavori: Bool {
        favoris.estFavori(fiche)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let categorie = service.categorie(de: fiche) {
                    Label(categorie.titre, systemImage: categorie.symbole)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color(hex: categorie.couleur))
                }

                Text(fiche.titre)
                    .font(.largeTitle.weight(.bold))
                    .fixedSize(horizontal: false, vertical: true)

                Text(fiche.resume)
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                Divider()

                // Le contenu est écrit en Markdown : titres, listes et gras
                // sont rendus nativement par SwiftUI.
                Text(LocalizedStringKey(fiche.contenu))
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color(.systemGroupedBackground))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    favoris.basculer(fiche)
                } label: {
                    Image(systemName: estFavori ? "star.fill" : "star")
                }
                .accessibilityLabel(estFavori ? "Retirer des favoris" : "Ajouter aux favoris")

                ShareLink(item: "\(fiche.titre)\n\n\(fiche.resume)") {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Partager la fiche")
            }
        }
    }
}
