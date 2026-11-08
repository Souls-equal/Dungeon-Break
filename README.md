# Dungeon Break — Bloxd.io

Prototype actuel : lobby de sélection de difficulté, compte à rebours individuel, génération procédurale de donjons à un seul niveau et téléportation.

Les règles de travail du projet sont consignées dans [`AGENT_RULES.md`](AGENT_RULES.md).

## Installer le lobby dans Bloxd

1. Dans ton monde Bloxd, construis les pads de difficulté avec les blocs **Concrete** listés ci-dessous. Le joueur doit pouvoir marcher directement sur leur surface.
2. Ouvre le **World Code** (touche `F8` par défaut).
3. Copie-colle le contenu de [`world-code/worldCode.js`](world-code/worldCode.js) dans le World Code, puis sauvegarde. Ce fichier est le bundle compacté, prêt à coller.
4. Entre dans le monde (spawn `10, 21, 10`) et marche sur un pad pour tester. Le compte à rebours s'affiche avec `middleTextUpper`; quitter tous les pads de la même difficulté l'annule.

## Sources et version compacte

Le code lisible est dans `src/` : `src/worldCode.js` contient le lobby, `src/utils/scheduler.js` le scheduler piloté par le callback `tick` de Bloxd, et `src/dungeon/generator.js` le générateur procédural par modules de salles. Le script de build les assemble en un seul fichier compact, `world-code/worldCode.js`, sans imports ni timers JavaScript natifs.

- `npm ci` installe le compilateur de build.
- `npm run build` régénère le fichier compact après les changements.
- `npm run watch` le régénère automatiquement à chaque sauvegarde dans `src/`.
- `npm run check` vérifie que la version compacte est à jour et valide les syntaxes.
- `npm test` lance les tests du scheduler, de la génération (types de modules, portes et couloirs, accessibilité à pied, escaliers, rayon de génération, box de spawn, audit du sol sous perte d'écritures, flux de salles) et du flux de téléportation simulé, dont un cas qui simule un chunk qui perd les écritures pour vérifier la réparation du sol de spawn.

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

Le donjon est un assemblage de **modules de salles** posés sur un seul niveau. La forme d'un module est son jeu de portes: c'est ce qui décide s'il s'agit d'un cul-de-sac, d'un couloir, d'un virage, d'un T, d'un croisement ou d'un escalier.

- **Six types de modules.** Un module à 1 porte est une `salle à une entrée` (cul-de-sac), 2 portes opposées donnent un `couloir`, 2 portes en angle un `virage`, 3 portes un `T` (chemin à trois directions) et 4 portes un `croisement`. Un module droit tiré au sort peut recevoir un `escalier` et change de type. Les modules sont 7×7, séparés par une case libre qui devient leur couloir.
- **Portes alignées, ouverture configurable.** Chaque porte fait `doorWidth: 3` blocs, centrée sur sa face (`doorHalfWidth()`). Deux modules voisins sont toujours séparés par exactement une case, donc leurs portes se répondent bloc pour bloc: le couloir partagé est carrelé une seule fois, par le module qui le possède, et n'est jamais traversé par un mur. Changer `doorWidth` suffit à élargir tous les passages de tous les modules.
- **Tirage par croissance depuis l'entrée.** Les cellules occupées sont tirées par une marche aléatoire qui part de la salle d'entrée, puis un arbre couvrant restreint à ces cellules relie tout le monde. Les passages supplémentaires (`extraPassageChance`) referment des boucles et font apparaître des croisements. Un parcours à pied vérifie que chaque salle reste atteignable, escaliers compris.
- **Roche d'emprise.** Tout ce qui n'est pas salle ou couloir reçoit de la roche, sur `wallHeight` blocs au-dessus du sol: les chambres semblent creusées dans la pierre, sans trou dans les murs. La roche épouse l'emprise réelle des salles retenues et n'utilise pas le matériau du sol, pour que le sol marchable se lise d'un coup d'œil.
- **Escaliers franchissables.** Un escalier est un module droit dont la voie centrale de 3 blocs est surélevée d'au plus 2 blocs (`STAIR_PROFILE = [0,0,1,2,2,1,0]`); les deux portes restent au niveau du sol, donc on le monte et le descend dans les deux sens. Deux escaliers ne se partagent jamais un couloir.
- **Décors non bloquants.** Les piliers restent dans les coins intérieurs: la croix centrale qui relie les portes est toujours libre.
- **Le joueur charge les chunks avant qu'on écrive.** C'est la cause des trous: Bloxd ne garde que les chunks chargés, et un `api.setBlock` visant un chunk non chargé est purement perdu. Le donjon n'est donc plus écrit pendant que le joueur est encore dans le lobby. La séquence est stricte:
  1. `api.getBlock` sur la case d'arrivée, pour forcer la création du chunk;
  2. pose de la plaque d'atterrissage (5×5 de **Stone Bricks**) autour de cette case;
  3. `api.setPosition` sur le **milieu de la case** (`x.5`, `z.5`), jamais sur un coin. La lecture et le premier `setBlock` sont séparés par **trois ticks** (`chunkWarmupTicks`): le chunk vient d'être créé, il n'accepte pas encore les écritures, et écrire tout de suite laissait un vide;
  4. fermeture d'une **box** de 3 blocs de haut autour du joueur (`boxWallOffset`), pour qu'il ne puisse pas sortir des chunks chargés avant que le sol existe. Elle ne recouvre jamais un mur, un escalier ou un décor de la salle.
  5. génération du donjon **uniquement dans un rayon de 60 blocs** (`generationRadius`) autour du joueur, moins de deux chunks, donc dans des chunks que son client a chargés.
- **Plan centré, build audité.** La salle d'entrée est placée au milieu de l'empreinte (`middleCellIndex`), ce qui ramène tout le niveau dans le rayon de 60 blocs, même en Hell. Le build est ensuite relu: `repairFloorTiles` lit chaque case de sol avec `api.getBlock` et réécrit celles que le monde n'a pas gardées, avant que la box s'ouvre. La même vérification a lieu après chaque salle streamée. Si le moteur ne sait pas relire les blocs, la réparation réécrit toutes les cases au lieu de supposer qu'elles sont correctes.
- **Entrée toujours traversante.** La salle d'entrée reçoit une porte nord (l'arrivée) et une porte sud (la sortie), et n'accueille jamais d'escalier: le joueur ne peut pas apparaître dans un cul-de-sac ni sur une marche.
- **Construction en flux borné.** Le générateur n'accumule pas la liste complète des blocs en mémoire: des itérateurs produisent les blocs un par un, à raison de 80 `api.setBlock` maximum par tick. Le coût mémoire reste constant, même pour les 48 salles du niveau Hell.
- **Salles suivantes: une vraie marche de modules.** Après la sortie, chaque module est placé **contre la case de couloir de la porte précédente**: la case d'ancrage est le couloir de sortie du module d'avant, et le module suivant est centré sur ce couloir (demi-salle, pas demi-porte). La porte d'entrée et la porte de sortie sont distantes d'une demi-salle de chaque côté, donc le couloir partagé est toujours carrelé par le module précédent: jamais de rangée vide entre deux modules, jamais de bloc écrit deux fois. Le tirage part tout droit et tourne souvent (`chooseStreamedModule`), et **refuse** une direction dont la salle recouvrirait un module déjà construit (`roomBoxesClash`): la route ne se replie pas sur elle-même. Quand aucune direction ne passe, le module devient un cul-de-sac et le flux s'arrête proprement. Un module n'est construit que s'il tient dans le rayon de 60 blocs autour du joueur; sinon, la génération attend qu'il avance (vérification toutes les 10 ticks, 36 blocs de marge).
- **Matériaux.** Chaque bloc mural choisit individuellement un matériau parmi **Stone**, **Messy Stone**, **Smooth Stone**, **Stone Bricks**, **Cracked Stone Bricks** et **Mossy Stone Bricks**. Les sols restent en **Stone Bricks**; la roche utilise une palette plus sobre (**Stone**, **Messy Stone**, **Smooth Stone**).
- **Difficulté.** `footprintByDifficulty` fixe la taille de la grille (4 à 10 cellules de côté) et `roomsByDifficulty` le nombre de modules visés (8 à 48). Le message de fin de construction annonce la répartition obtenue: croisements, T, virages, couloirs, culs-de-sac et escaliers.
- Chaque donjon reçoit un emplacement horizontal aléatoire dans les bornes `-50000..50000` en X et Z; le sol est à `Y = -1000`. La génération continue jusqu'à la limite de coordonnées configurée, le monde n'étant pas mathématiquement infini.

C'est volontairement une première version : pas encore de mobs, butin, nettoyage après une partie ni contrôle d'accès au donjon. Le délai est configurable via `countdownSeconds` dans `src/worldCode.js`; dimensions des salles, portes, distance de pré-génération et matériaux sont configurés par `DUNGEON_CONFIG` dans `src/dungeon/generator.js`.

## Documentation Bloxd utilisée

- [Getting started — World Code](https://bloxd.io/docs/getting-started)
- [Callbacks — onBlockStandStart / onBlockStandStop / tick](https://bloxd.io/docs/callbacks)
- [API Reference](https://bloxd.io/docs/api-reference)
