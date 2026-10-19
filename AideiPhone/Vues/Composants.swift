//
//  Composants.swift
//  AideiPhone
//
//  Vues réutilisables et utilitaires d'affichage.
//

import SwiftUI

// MARK: - États de chargement et d'erreur

struct VueChargement: View {
    var corps: String = "Chargement des fiches d’aide…"

    var body: some View {
        ContentUnavailableView {
            ProgressView()
        } description: {
            Text(corps)
        }
        .accessibilityLabel(corps)
    }
}

struct VueErreur: View {
    let message: String
    let actionReessayer: () -> Void
    /// Affiche le second bouton si fourni.
    var actionHorsLigne: (() -> Void)?

    var body: some View {
        ContentUnavailableView {
            Label("Contenu indisponible", systemImage: "wifi.exclamationmark")
        } description: {
            Text(message)
        } actions: {
            VStack(spacing: 12) {
                Button(action: actionReessayer) {
                    Label("Réessayer", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)

                if let actionHorsLigne {
                    Button("Utiliser le contenu hors ligne", action: actionHorsLigne)
                        .buttonStyle(.bordered)
                }
            }
        }
    }
}

/// Bannière discrète affichée quand l'application fonctionne hors ligne.
struct VueBandeauHorsLigne: View {
    var body: some View {
        Label(
            "Contenu embarqué : ajoutez « GoogleService-Info.plist » pour activer Firebase.",
            systemImage: "icloud.slash"
        )
        .font(.footnote)
        .foregroundStyle(.secondary)
        .padding(.vertical, 4)
    }
}

// MARK: - Lignes de liste

/// Ligne représentant une catégorie sur l'écran d'accueil.
struct VueLigneCategorie: View {
    let categorie: Categorie
    let nombreDeFiches: Int

    private var texteNombre: String {
        nombreDeFiches > 1
            ? "\(nombreDeFiches) fiches"
            : "\(nombreDeFiches) fiche"
    }

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: categorie.symbole)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: 40, height: 40)
                .background(
                    Color(hex: categorie.couleur).gradient,
                    in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(categorie.titre)
                    .font(.body.weight(.semibold))
                Text(categorie.resume)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(texteNombre)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Ligne représentant une fiche, avec repère si elle est en favori.
struct VueLigneFiche: View {
    let fiche: Fiche
    @Environment(ServiceFavoris.self) private var favoris

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(fiche.titre)
                    .font(.body.weight(.semibold))
                Text(fiche.resume)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if favoris.estFavori(fiche) {
                Image(systemName: "star.fill")
                    .foregroundStyle(.yellow)
                    .accessibilityLabel("Favori")
            }
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Couleur au format hexadécimal

extension Color {
    /// Crée une couleur à partir d'une chaîne comme « #0A84FF ».
    init(hex: String) {
        let caracteres = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var valeur: UInt64 = 0
        Scanner(string: caracteres).scanHexInt64(&valeur)

        let rouge, vert, bleu: Double
        if caracteres.count == 6 {
            rouge = Double((valeur >> 16) & 0xFF) / 255.0
            vert = Double((valeur >> 8) & 0xFF) / 255.0
            bleu = Double(valeur & 0xFF) / 255.0
        } else {
            rouge = 0.0
            vert = 0.47
            bleu = 1.0
        }
        self.init(red: rouge, green: vert, blue: bleu)
    }
}
