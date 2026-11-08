# Dungeon Break — Bloxd.io

Prototype actuel : lobby de sélection de difficulté, compte à rebours individuel, génération procédurale de donjons à un seul niveau et téléportation.

Les règles de travail du projet sont consignées dans [`AGENT_RULES.md`](AGENT_RULES.md).

## Installer le lobby dans Bloxd

1. Dans ton monde Bloxd, construis les pads de difficulté avec les blocs **Concrete** listés ci-dessous. Le joueur doit pouvoir marcher directement sur leur surface.
2. Ouvre le **World Code** (touche `F8` par défaut).
3. Copie-colle le contenu de [`world-code/worldCode.js`](world-code/worldCode.js) dans le World Code, puis sauvegarde. Ce fichier est le bundle compacté, prêt à coller.
4. Entre dans le monde (spawn `10, 21, 10`) et marche sur un pad pour tester. Le compte à rebours s'affiche avec `middleTextUpper`; quitter tous les pads de la même difficulté l'annule.

## Sources et version compacte

Le code lisible est dans `src/` : `src/worldCode.js` contient le lobby, `src/utils/scheduler.js` le scheduler piloté par le callback `tick` de Bloxd, et `src/dungeon/generator.js` le générateur procédural. Le script de build les assemble en un seul fichier compact, `world-code/worldCode.js`, sans imports ni timers JavaScript natifs.

- `npm ci` installe le compilateur de build.
- `npm run build` régénère le fichier compact après les changements.
- `npm run watch` le régénère automatiquement à chaque sauvegarde dans `src/`.
- `npm run check` vérifie que la version compacte est à jour et valide les syntaxes.
- `npm test` lance les tests du scheduler, de la génération (salles, portes, sols, flux de salles) et du flux de téléportation simulé, dont un cas qui simule un chunk qui perd les écritures pour vérifier la réparation du sol de spawn.

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

Le donjon est un assemblage de **salles autonomes** posées sur un seul niveau, comme des pièces de puzzle.

- **Salles complètes.** Chaque salle est un module 5×5 dont le sol, les quatre murs et les décors sont générés ensemble. Le sol d'une salle ne dépend donc jamais d'une autre salle, et une salle n'est jamais traversée par un mur qui ne lui appartient pas. Chaque bloc n'est produit qu'une seule fois, coins et linteaux compris.
- **Portes alignées.** Chaque salle ouvre des portes de 3 blocs, centrées sur ses faces. Deux salles voisines sont séparées par une case libre qui devient leur couloir: la salle existante pose le sol de ce couloir, si bien que la connexion est toujours carrelée et jamais obstruée par un mur. Chaque passage est stocké une seule fois, donc les deux salles s'accordent forcément sur la porte partagée.
- **Labyrinthe connecté.** Un arbre couvrant aléatoire relie toutes les salles depuis l'entrée, puis quelques passages supplémentaires (12 % de chance) créent des boucles. Un test vérifie par un parcours en largeur que chaque salle reste accessible à pied.
- **Décors non bloquants.** Les piliers et alcôves restent dans les coins des salles: la croix centrale de 3 blocs qui relie les portes est toujours libre.
- **Sol de spawn garanti, même si le monde perd des écritures.** Bloxd écrit les blocs par chunks: un `api.setBlock` visant un chunk que le serveur n'a pas encore chargé peut être purement perdu, ce qui laissait de temps en temps un trou sous le joueur. Trois protections se cumulent désormais:
  1. la cellule d'arrivée est lue (`api.getBlock`) dès le déclenchement, ce qui force la création du chunk avant la première écriture, puis re-lue à chaque tick de construction;
  2. la plaque 3×3 de **Stone Bricks** est posée en tout premier, et ré-affirmée complètement juste avant `api.setPosition`;
  3. après la téléportation, une garde relit la plaque toutes les 5 ticks (`spawnCheckTicks`) et réécrit les cases perdues, en replaçant le joueur sur le pad s'il est passé sous le sol. Elle s'arrête dès que la plaque est complète, ou après `spawnCheckAttempts` vérifications.
  Si le moteur ne sait pas relire les blocs, la garde réécrit la plaque entière au premier passage au lieu de supposer qu'elle est correcte.
- **Construction en flux borné.** Le générateur n'accumule plus la liste complète des blocs en mémoire: des itérateurs produisent les blocs un par un, à raison de 120 `api.setBlock` maximum par tick. Le coût mémoire reste constant, même pour les 121 salles du niveau Hell.
- **Salles suivantes.** Après la sortie, des salles 7×7 à 9×9 sont construites à la suite, avec les mêmes portes centrées: le couloir de sortie du niveau initial ouvre directement sur la porte d'entrée de la salle suivante. Le joueur peut avancer de 36 blocs avant que la génération ne soit relancée, toutes les 10 ticks, toujours sur le même niveau. La dernière salle ferme sa sortie et la génération s'arrête au bord du monde.
- **Matériaux.** Chaque bloc mural choisit individuellement un matériau parmi **Stone**, **Messy Stone**, **Smooth Stone**, **Stone Bricks**, **Cracked Stone Bricks** et **Mossy Stone Bricks**. Les sols restent en **Stone Bricks**.
- Chaque donjon reçoit un emplacement horizontal aléatoire dans les bornes `-50000..50000` en X et Z; le sol est à `Y = -1000`. La génération continue jusqu'à la limite de coordonnées configurée, le monde n'étant pas mathématiquement infini.

C'est volontairement une première version : pas encore de mobs, butin, nettoyage après une partie ni contrôle d'accès au donjon. Le délai est configurable via `countdownSeconds` dans `src/worldCode.js`; dimensions des salles, portes, distance de pré-génération et matériaux sont configurés par `DUNGEON_CONFIG` dans `src/dungeon/generator.js`.

## Documentation Bloxd utilisée

- [Getting started — World Code](https://bloxd.io/docs/getting-started)
- [Callbacks — onBlockStandStart / onBlockStandStop / tick](https://bloxd.io/docs/callbacks)
- [API Reference](https://bloxd.io/docs/api-reference)
