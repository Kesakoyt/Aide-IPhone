# Aide iPhone 📱

Application iOS (SwiftUI) qui héberge des **fiches d'aide en français** pour apprendre à utiliser un iPhone. Le contenu est servi par **Firebase Firestore**, avec un jeu de données embarqué qui prend le relais automatiquement en cas d'absence de configuration ou de coupure réseau.

Le respect des **Apple Human Interface Guidelines** est assuré par l'utilisation exclusive des composants natifs : `TabView`, `NavigationStack`, listes inset-grouped, SF Symbols, `ContentUnavailableView`, `searchable`, Dynamic Type et mode sombre automatique.

## Fonctionnalités

- 📚 **6 catégories** et **16 fiches** d'aide rédigées en français (premiers pas, photos, confidentialité, batterie, applications, accessibilité)
- 🔍 **Recherche globale** insensible à la casse et aux accents, résultats groupés par catégorie
- ⭐ **Favoris** stockés localement sur l'appareil
- 📤 **Partage** native d'une fiche (`ShareLink`)
- 🔌 **Mode hors ligne** : si Firestore n'est pas configuré ou injoignable, l'application affiche le contenu embarqué `donnees_exemple.json`

## Prérequis

- **Xcode 16** ou plus récent (le projet utilise les groupes synchronisés sur le disque)
- iOS **17.0** minimum
- Un projet [Firebase](https://console.firebase.google.com/) (facultatif au premier lancement)

## Démarrage rapide

1. Ouvrir `AideiPhone.xcodeproj` dans Xcode.
2. Laisser Xcode résoudre le paquet Swift **firebase-ios-sdk** (premier lancement : quelques minutes).
3. Choisir un simulateur iPhone et lancer **⌘R**.

À ce stade, l'app fonctionne déjà : elle affiche le contenu embarqué avec une bannière indiquant que Firebase n'est pas encore configuré.

## Connecter Firebase (étape recommandée)

1. Dans la [console Firebase](https://console.firebase.google.com/), créer un projet, puis ajouter une application iOS avec l'identifiant `com.aideiphone.app`.
2. Télécharger le fichier **`GoogleService-Info.plist`** et le déposer dans le dossier `AideiPhone/` du projet (le groupe synchronisé l'inclut automatiquement à la compilation). Ce fichier est ignoré par git.
3. Dans Firebase, activer **Cloud Firestore** (mode production, région d'Europe de l'Ouest par exemple).
4. Publier les règles de sécurité fournies dans `firebase/regles-firestore.rules` (lecture publique, écriture interdite).
5. Peupler la base avec le contenu des fiches :

   ```bash
   cd firebase
   npm install firebase-admin
   GOOGLE_APPLICATION_CREDENTIALS=compte-de-service.json node peuplement.js
   ```

6. Relancer l'application : le bandeau hors ligne disparaît, les données viennent de Firestore.

## Modèle de données

| Collection    | Champs                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| `categories`  | `id`, `titre`, `resume`, `symbole` (SF Symbol), `couleur` (hex), `ordre`                 |
| `fiches`      | `id`, `titre`, `resume`, `contenu` (Markdown), `categorieID`, `motsCles`, `ordre`        |

Pour ajouter une fiche : créer un document dans la collection `fiches` (depuis la console Firebase ou en étendant `donnees_exemple.json` puis en relançant le script de peuplement). Le champ `contenu` accepte le Markdown (titres `##`, listes numérotées, **gras**).

## Structure du projet

```
AideiPhone/
├── AideiPhoneApp.swift        # Point d'entrée, injection des services
├── Modeles/Modeles.swift      # Categorie, Fiche (Codable)
├── Services/
│   ├── ServiceAide.swift      # Chargement Firestore + repli hors ligne
│   └── ServiceFavoris.swift   # Favoris persistés (UserDefaults)
├── Vues/
│   ├── VueContenu.swift       # TabView (Accueil, Recherche, Favoris)
│   ├── VueAccueil.swift       # Liste des catégories
│   ├── VueCategorie.swift     # Fiches d'une catégorie
│   ├── VueFiche.swift         # Lecture d'une fiche + favori/partage
│   ├── VueRecherche.swift     # Recherche globale
│   ├── VueFavoris.swift       # Fiches favorites
│   └── Composants.swift       # Lignes d'écran, états vides, couleur hex
└── Ressources/donnees_exemple.json   # Contenu embarqué (secours + peuplement)
```

## Licence

Voir le fichier `LICENSE`.
