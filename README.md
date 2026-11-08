# Dungeon Break — Bloxd.io

Prototype actuel : lobby de sélection de difficulté, compte à rebours individuel, génération procédurale de donjons multi-niveaux et téléportation.

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

- Après le compte à rebours, le donjon est construit en **Stone Bricks**, par lots sur plusieurs ticks. Le joueur est téléporté dans la salle d'entrée une fois la construction terminée.
- La taille évolue de 4×4 salles en Very Easy à 11×11 en Hell. Les difficultés prévoient respectivement 2 niveaux (Very Easy/Easy), 3 (Medium/Normal/Hard), 4 (Insane/Ultra Insane) ou 5 (Hell), avec des labyrinthes distincts à chaque niveau.
- Les salles de 5×5 blocs varient : espaces ouverts, piliers simples ou doubles, et alcôves. Dans chaque niveau, les passages sont parfois étroits (3 blocs), parfois ouverts sur toute la largeur.
- Une cage d'escalier en spirale, faite de blocs pleins Stone Bricks, relie les étages à travers un puits de 3×3 blocs. L'entrée se trouve au niveau inférieur, la sortie au niveau supérieur, et de petites plateformes Stone Bricks prolongent ces ouvertures.
- Après la sortie supérieure, des salles modulaires 7×7 ou 9×9 sont ajoutées par lots à mesure que le joueur avance. La position est vérifiée toutes les 10 ticks et la prochaine salle commence à se construire lorsque le joueur approche à 18 blocs de la limite générée.
- Chaque donjon reçoit un emplacement horizontal aléatoire dans les bornes `-50000..50000` en X et Z ; le premier sol est à `Y = -1000`, avec 8 blocs d'écart vertical entre niveaux. La génération continue jusqu'à la limite de coordonnées configurée, le monde n'étant pas mathématiquement infini.

C'est volontairement une première version : pas encore de mobs, butin, nettoyage après une partie ni contrôle d'accès au donjon. Le délai est configurable via `countdownSeconds` dans `src/worldCode.js`; dimensions, niveaux et matériau sont configurés dans `src/dungeon/generator.js`.

## Documentation Bloxd utilisée

- [Getting started — World Code](https://bloxd.io/docs/getting-started)
- [Callbacks — onBlockStandStart / onBlockStandStop / tick](https://bloxd.io/docs/callbacks)
- [API Reference](https://bloxd.io/docs/api-reference)
