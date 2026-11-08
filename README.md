# Dungeon Break — Bloxd.io

Première étape du projet : un lobby de sélection de difficulté avec un compte à rebours individuel par joueur.

## Installer le lobby dans Bloxd

1. Dans ton monde Bloxd, construis les pads de difficulté avec les blocs **Concrete** listés ci-dessous. Le joueur doit pouvoir marcher directement sur leur surface.
2. Ouvre le **World Code** (touche `F8` par défaut).
3. Copie-colle le contenu complet de [`src/worldCode.js`](src/worldCode.js) dans le World Code, puis sauvegarde.
4. Entre dans le monde et marche sur un pad pour tester. Quitter le pad annule le compte à rebours.

Le script est autonome : il ne nécessite ni module, ni compilation. Le dossier `src/` contient le code à recopier dans Bloxd, avec les mêmes chemins que dans ce dépôt.

## Pads de difficulté

| Bloc à poser | Difficulté affichée |
| --- | --- |
| Lime Concrete | Very Easy |
| Light Blue Concrete | Easy |
| Yellow Concrete | Medium |
| Orange Concrete | Normal |
| Red Concrete | Hard |
| Purple Concrete | Insane |
| Gray Concrete | Ultra Insane |
| Black Concrete | Hell |

Tous les textes visibles par les joueurs sont en anglais.

## Fonctionnement actuel

- La sélection se déclenche quand un joueur entre sur un bloc Concrete reconnu.
- Chaque joueur a son propre compte à rebours de 10 secondes.
- Marcher hors du pad pendant le compte à rebours l'annule. Passer directement sur un autre pad remplace la sélection en cours.
- À la fin du compte à rebours, le script confirme la difficulté choisie.
- La génération du donjon et la téléportation ne sont pas encore incluses : elles seront ajoutées à l'étape suivante.

Le délai est configurable via `countdownSeconds` en haut de `src/worldCode.js`.

## Documentation Bloxd utilisée

- [Getting started — World Code](https://bloxd.io/docs/getting-started)
- [Callbacks — onBlockStandStart / onBlockStandStop / tick](https://bloxd.io/docs/callbacks)
- [API Reference](https://bloxd.io/docs/api-reference)
