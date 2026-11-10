# Dungeon Break — Bloxd.io

Prototype actuel : lobby de sélection de difficulté, compte à rebours individuel, génération procédurale de donjons à un seul niveau et téléportation.

Les règles de travail du projet sont consignées dans [`AGENT_RULES.md`](AGENT_RULES.md).

> **Chantier en cours.** Le moteur de donjon par ouvertures est conçu mais pas encore implémenté : l'architecture complète, les limites d'API vérifiées et le plan de tests sont dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Il attend la validation des décisions listées en §20 avant le début de la Phase 1.

## Installer le lobby dans Bloxd

1. Dans ton monde Bloxd, construis les pads de difficulté avec les blocs **Concrete** listés ci-dessous. Le joueur doit pouvoir marcher directement sur leur surface.
2. Ouvre le **World Code** (touche `F8` par défaut).
3. Copie-colle le contenu de [`world-code/worldCode.js`](world-code/worldCode.js) dans le World Code, puis sauvegarde. Ce fichier est le bundle compacté, prêt à coller.
4. Entre dans le monde (spawn `10, 21, 10`) et marche sur un pad pour tester. Le compte à rebours s'affiche avec `middleTextUpper`; quitter tous les pads de la même difficulté l'annule.

## Commandes de debug (rapport de bug)

En jeu, dans le chat :

| Commande | Effet |
| --- | --- |
| `/dbg` | Rapport complet : graine, cellule, salle (taille, origine, avancement de construction, portes libres), porte sous les pieds, couloir le plus proche, salles voisines, bloc sous les pieds |
| `/dbg hud` | Affiche une ligne en haut de l'écran — `seed … · x,z · salle ou couloir`. **À activer avant de faire une capture** : la photo se lit alors toute seule |
| `/dbg seed` | La graine seule, en une ligne |
| `/dbg dungeon` | L'état du donjon entier : salles, liens, boucles, construction, refus du générateur |
| `/dbg near [rayon]` | Les salles autour de soi, avec leur état et leurs portes libres |
| `/dbg short` | La position seule |
| `/dbg chunk [rayon]` | Les records de chunk autour de soi, **relus depuis les blocs** : plans, progression, graine, tick. Répond à « mon donjon a-t-il survécu » |
| `/dbg mem` | Ce que le moteur retient, par difficulté : salles / plafond, ouvertures, liens, travail en attente, records. Le rapport pour `out of memory` |

Une capture d'écran + le texte de `/dbg` suffisent pour reproduire exactement la géométrie en local :

```
node tools/visualize-dungeon.mjs --seed <graine> --rooms <nombre de salles>
```

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

## Records de chunk, et ticks qui n'explosent pas

Deux garde-fous, ajoutés après des `World code tick: InternalError: interrupted` en jeu.

**Un record par chunk, dans la data d'un bloc.** `api.setBlockData(x, y, z, objet)` écrit, `api.getBlockData(x, y, z)` relit. Chaque chunk reçoit **une ancre**, à son coin et au niveau du sol — `(chunkX × 32, floorY, chunkZ × 32)`, bloc `Polished Diorite`, volontairement hors palette. Le record tient en un objet plat de chaînes courtes (format v1) :

```
{ v: 1, id: "<difficulté>", seed, cx, cz, y, tick,
  plans:    ["room|4211|r0.1", "passage|840|c:r0.1.o2+r0.o1"],
  progress: ["room|built|4211|r0.1", "passage|building|360|c:r0.1.o2+r0.o1"] }
```

Les plans disent ce que le chunk contient et combien de blocs chaque partie écrit ; la progression dit où chaque partie en est. L'identifiant est **le dernier champ**, après un séparateur `|`, parce qu'un id de connexion contient déjà des `:` et des `+` — c'est ce qui a cassé la première version du format.

Trois règles, et la deuxième est la plus importante :

1. **L'ancre est scellée.** Le bloc est posé une fois, puis le constructeur refuse toute écriture sur cette cellule. Une salle construite par-dessus ne peut donc pas effacer le record, qui disparaît sinon au premier `setBlock` sur la case.
2. **Ce n'est pas une source de vérité, c'est un filet de sécurité.** La doc Bloxd est explicite : *« Data is cleared when block changes »*. Le donjon se reconstruit de toute façon depuis sa graine ; le record sert à relire ce qui était déjà là et où la construction en était. Quand la donnée a disparu, le code le dit (`NO_ANCHOR`, `CHUNK_NOT_LOADED`) au lieu de faire semblant.
3. **Un chunk par tick, et seulement si son ancre est lisible.** Écrire au-delà de ce que le serveur a chargé perd l'écriture sans erreur, donc un chunk dont l'ancre renvoie `null` n'est pas écrit du tout.

**Un garde-temps dans le contrôleur.** `interrupted` est un coupe-circuit du serveur : un tick trop long est tué. Mesuré sur ce dépôt, le pire tick atteignait **164 ms**, dont **147 ms dans une seule génération de salle** — un coût que le budget en blocs ne voyait pas. Le contrôleur porte donc `tickBudgetMs = 40` (sous le tick de 50 ms du serveur) et `tickReserveShare = 0.85` : plus aucune salle ni passage n'est **commencé** après 34 ms, mais l'unité en cours se termine toujours. Résultat mesuré : pire tick **51 ms**, et **aucune salle ni passage perdu** — le travail reporté reste dans les files.

Dans le jeu, `Date.now()` et `api.now()` sont figés pendant le tick, donc ce garde-temps est inerte en production et n'agit que côté hôte : c'est une limite connue, pas une garantie. Le vrai filet en jeu reste le budget d'opérations par tick.

## Mémoire : `InternalError: out of memory`

Cette erreur n'est pas un tick trop long, c'est un **tas épuisé** — et presque jamais une grosse allocation : une structure qui grossit à chaque tick. Deux causes mesurées, corrigées :

- **Aucun plafond de salles.** La table des difficultés annonce 10 salles pour Very Easy et 48 pour Hell, mais ce nombre n'était lu par personne : le générateur produisait tant qu'il restait une porte en attente, et une frontière de portes ne s'épuise pas. Mesuré avant correctif : **Very Easy à 114 salles** et toujours en hausse, tas de 6 → 591 Mo en 3 000 ticks. Le contrôleur reçoit désormais `maxRooms: difficulty.rooms` et s'arrête à la cible (files vidées, `stats.capped` compte les refus).
- **Plans de salles jamais libérés.** Chaque salle gardait la liste complète de ses blocs pour pouvoir reprendre au curseur : 562 851 blocs retenus sur un donjon de 175 salles. Le plan est libéré dès la salle terminée.

Après correctif, sur 3 000 ticks : Very Easy **10 salles / ~20 Mo stables**, Hell **48 salles / ~150 Mo stables**. La liste complète des structures qui peuvent grossir — index spatial, cellules de couloir, files, état par joueur, journalisation — est dans [`docs/MEMOIRE.md`](docs/MEMOIRE.md).

Limite connue : un joueur qui quitte sans passer par `onPlayerLeave` (crash client) reste enregistré, et le contrôleur découvre des portes autour de son fantôme. Aucun garde-fou aujourd'hui.

## Documentation Bloxd utilisée

- [Getting started — World Code](https://bloxd.io/docs/getting-started)
- [Callbacks — onBlockStandStart / onBlockStandStop / tick](https://bloxd.io/docs/callbacks)
- [API Reference](https://bloxd.io/docs/api-reference)
