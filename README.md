# Dungeon Break — Bloxd.io

Prototype actuel : lobby de sélection de difficulté, compte à rebours individuel, génération d'un premier labyrinthe et téléportation.

Les règles de travail du projet sont consignées dans [`AGENT_RULES.md`](AGENT_RULES.md).

## Installer le lobby dans Bloxd

1. Dans ton monde Bloxd, construis les pads de difficulté avec les blocs **Concrete** listés ci-dessous. Le joueur doit pouvoir marcher directement sur leur surface.
2. Ouvre le **World Code** (touche `F8` par défaut).
3. Copie-colle le contenu de [`world-code/worldCode.js`](world-code/worldCode.js) dans le World Code, puis sauvegarde. Ce fichier est le bundle compacté, prêt à coller.
4. Entre dans le monde et marche sur un pad pour tester. Quitter le pad annule le compte à rebours.

## Sources et version compacte

Le code lisible est dans `src/` : `src/worldCode.js` contient le lobby, `src/utils/scheduler.js` le scheduler piloté par le callback `tick` de Bloxd, et `src/dungeon/generator.js` le générateur procédural. Le script de build les assemble en un seul fichier compact, `world-code/worldCode.js`, sans imports ni timers JavaScript natifs.

- `npm ci` installe le compilateur de build.
- `npm run build` régénère le fichier compact après les changements.
- `npm run watch` le régénère automatiquement à chaque sauvegarde dans `src/`.
- `npm run check` vérifie que la version compacte est à jour et valide les syntaxes.
- `npm test` lance les tests du scheduler, de la génération et du flux de téléportation simulé.

Le workflow GitHub vérifie la version générée sur les Pull Requests et resynchronise `world-code/` après les changements fusionnés dans `main`. Modifie toujours `src/`, jamais le fichier généré directement.

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

## Génération actuelle du donjon

- Après le compte à rebours, un labyrinthe procédural est construit avec des sols et murs en **Stone Bricks**.
- La taille évolue selon la difficulté : de 4×4 salles en Very Easy à 11×11 en Hell. Un algorithme de parcours aléatoire choisit les passages.
- Chaque donjon reçoit un emplacement horizontal aléatoire dans les bornes `-50000..50000` en X et Z ; son sol est à `Y = -1000`.
- Les blocs sont posés par lots sur plusieurs ticks. Une fois la construction terminée, le joueur est téléporté dans la salle de départ ; une ouverture opposée sert de sortie.

C'est volontairement une première version : pas encore de mobs, butin, salles spéciales, nettoyage après une partie ni contrôle d'accès au donjon. Le délai est configurable via `countdownSeconds` dans `src/worldCode.js`; dimensions et matériau sont configurés dans `src/dungeon/generator.js`.

## Documentation Bloxd utilisée

- [Getting started — World Code](https://bloxd.io/docs/getting-started)
- [Callbacks — onBlockStandStart / onBlockStandStop / tick](https://bloxd.io/docs/callbacks)
- [API Reference](https://bloxd.io/docs/api-reference)
