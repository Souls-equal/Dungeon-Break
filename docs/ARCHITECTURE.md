# Architecture — moteur de donjon procédural infini

**Statut : vivant. Phase 0 livrée, Phase 1 livrée, Phase 3 livrée.** L'audit est dans [`AUDIT-PHASE0.md`](AUDIT-PHASE0.md). Les sections marquées **✅ Implémenté** décrivent du code qui existe, testé, dans `src/dungeon/engine/` ; celles marquées **◻ À venir** décrivent une conception encore à réaliser, et le sont pour mémoire.

Ce document est mis à jour à chaque phase. Une divergence entre ce texte et le code est un défaut : le code fait foi, et c'est le document qu'il faut corriger — mais tout écart doit être signalé explicitement, jamais laissé implicite.

Les règles de travail du projet sont dans [`AGENT_RULES.md`](../AGENT_RULES.md). Les fonctions Bloxd citées ici sont toutes documentées ; chaque citation renvoie à la page exacte qui la décrit (voir §2.2) ; les cas où la documentation est muette sont signalés comme tels (§3, §19).

---

## Sommaire

1. [Périmètre et principes directeurs](#1-périmètre-et-principes-directeurs)
2. [Références documentaires vérifiées](#2-références-documentaires-vérifiées)
3. [Limites de la plateforme et leurs conséquences](#3-limites-de-la-plateforme-et-leurs-conséquences)
4. [Vue d'ensemble des modules](#4-vue-densemble-des-modules)
5. [Système de coordonnées](#5-système-de-coordonnées)
6. [Structures de données versionnées](#6-structures-de-données-versionnées)
7. [Formes procédurales et géométrie](#7-formes-procédurales-et-géométrie)
8. [Ouvertures](#8-ouvertures)
9. [Algorithme de génération par ouvertures](#9-algorithme-de-génération-par-ouvertures)
10. [Validation et atomicité](#10-validation-et-atomicité)
11. [Index spatial](#11-index-spatial)
12. [Anticipation : les trois opérations et les trois files](#12-anticipation--les-trois-opérations-et-les-trois-files)
13. [Construction physique](#13-construction-physique)
14. [Persistance](#14-persistance)
15. [Suivi des modifications physiques — supprimé](#15-suivi-des-modifications-physiques--supprimé)
16. [Garanties de performance](#16-garanties-de-performance)
17. [Plan de tests](#17-plan-de-tests)
18. [Découpage en phases](#18-découpage-en-phases)
19. [Risques et points non résolus](#19-risques-et-points-non-résolus)
20. [Décisions demandées avant la Phase 1](#20-décisions-demandées-avant-la-phase-1)

Annexes : [A — Ce qui reste du code existant](#annexe-a--ce-qui-reste-du-code-existant) · [B — Paramètres par défaut](#annexe-b--paramètres-par-défaut-tous-dans-une-seule-configuration) · [C — Sources non officielles](#annexe-c--sources-non-officielles-utilisées-et-leur-statut)

---

## 1. Périmètre et principes directeurs

Le moteur remplace la génération actuelle (`src/dungeon/generator.js`, marche de modules 7×7 raccordés par une case de couloir). Le lobby, le compte à rebours et le spawn restent inchangés ; ils seront rebranchés en Phase 4.

**Boucle de jeu retenue** (décidée en Phase 0, elle contraint tout le reste) :

- un joueur qui se connecte est **toujours** renvoyé au lobby ; aucune position n'est reprise ;
- le lobby porte **trois pads** : Very Easy, Easy, Medium ;
- à l'intérieur d'un donjon, un **pad** mène à la difficulté suivante, jusqu'à Hell qui est un cul-de-sac de progression ;
- un pad n'est **jamais** une ouverture : il ne participe pas au graphe des salles, il est posé par le constructeur et il est persisté avec le donjon ;
- les murs sont **indestructibles** : il n'y a donc aucun suivi de modifications à faire (voir §15, révisé) ;
- les minerais, coffres et monstres viendront **après** que la structure soit fiable.

Six principes, qui se traduisent chacun par une règle vérifiable dans le code :

| Principe | Règle concrète |
| --- | --- |
| Séparer le logique du physique | Les modules de `src/dungeon/engine/` ne connaissent **ni `api.getBlock` ni `api.setBlock`**. Seuls `DungeonBuilder` et `DungeonPersistence` touchent le monde et la base. Un test d'architecture vérifie l'absence de la chaîne `api.` dans tout `src/dungeon/engine/`. |
| Séparer génération et construction | La génération produit une salle **validée et enregistrée** ; la construction est une seconde opération, indépendante, reprenable, qui reçoit une salle déjà connue avec ses ouvertures. |
| Une connexion relie deux ouvertures identifiées | Aucune connexion n'est déduite d'une proximité : `Connection { a: openingId, b: openingId }`. Un test refuse toute connexion dont l'un des deux identifiants n'existe pas. |
| Atomicité | Le validateur est une fonction pure : il ne modifie rien. Une salle n'entre dans le graphe que par un seul point de commit, après validation complète. Un échec ne laisse aucune trace. |
| Déterminisme | Aucun générateur aléatoire partagé. Une salle est entièrement déterminée par `hash(dungeonSeed, parentRoomId, openingId, attempt)`. Même seed ⇒ même donjon, quel que soit l'ordre d'exploration. |
| Coût borné | Toute recherche de voisinage passe par l'index spatial. Aucune fonction ne parcourt l'ensemble des salles. Un test mesure le coût par cycle et échoue si la durée croît avec le nombre de salles. |

---

## 2. Références documentaires vérifiées

### 2.1 Pages consultées

| Page | URL |
| --- | --- |
| Index de la documentation | <https://bloxd.io/docs> |
| API Reference (5 parties) | <https://bloxd.io/docs/api-reference.md> |
| Callbacks (3 parties) | <https://bloxd.io/docs/callbacks.md> |
| Types | <https://bloxd.io/docs/types.md> |
| Getting started (globales, `api.log`) | <https://bloxd.io/docs/getting-started.md> |
| Plugins (`@plugins/helpers`) | <https://bloxd.io/docs/how-to-plugins.md> |
| Changelog officiel | <https://bloxd.io/docs/changelog> |
| Miroir GitHub de la doc | <https://github.com/Bloxdy/code-api> |

La documentation est également publiée en Markdown (`/docs/<page>.md`), ce qui a permis de vérifier les signatures sans passer par le rendu de la page.

### 2.2 Fonctions utilisées, avec leur référence

| Fonction | Signature documentée | Usage dans le moteur |
| --- | --- | --- |
| `api.getBlock` | `getBlock(x, y, z)` ou `getBlock([x, y, z]) → BlockName` | Lecture de vérification après écriture, réchauffement de chunk, détection de modification externe. |
| `api.setBlock` | `setBlock(x, y, z, blockName)` ou `setBlock([x,y,z], blockName)` | Écriture unique du constructeur. La doc précise qu'elle est optimisée pour de grandes quantités de blocs écrits dans des boucles imbriquées. |
| `api.setBlockRect` | `setBlockRect(pos1, pos2, blockName)` | Remplissage du sol et du plafond d'un rectangle logique en un appel. |
| `api.setBlockWalls` | `setBlockWalls(pos1, pos2, blockName, hasFloor, hasCeiling)` | **Non utilisé** pour les murs de salles : crée une coque pleine, incompatible avec l'exigence « jamais de mur plein puis percé ». Réservé aux volumes aveugles (roche d'emprise), après découpe des passages. |
| `api.getBlockSolidity` | `getBlockSolidity(x, y, z) → boolean` | **Non utilisé pour valider** : la doc dit « *Will be true if the block is unloaded* », donc un chunk non chargé est indiscernable d'un bloc plein. |
| `api.isBlockInLoadedChunk` | `isBlockInLoadedChunk(x, y, z) → boolean` | Garde avant toute écriture : le constructeur reporte la salle tant que les chunks du volume ne sont pas chargés. |
| `api.getBlockId` / `blockIdToBlockName` / `blockNameToBlockId` | conversion nom ↔ id numérique | Le constructeur écrit à partir de noms. La doc dit de `getBlockId` : « *Intended only for use in hot code paths* » : optimisation de vérification **possible**, à mesurer en Phase 4, jamais supposée. |
| `api.getBlockData` / `api.setBlockData` | lecture/écriture de données de bloc | **Jamais utilisés pour persister** : la doc dit « *Data is cleared when block changes* ». |
| `api.getEmptyChunk` | `getEmptyChunk() → GameChunk` (« *32x32x32 ndarray of air* ») | **Inutilisable seul** : la doc renvoie à `resetChunk` pour poser le chunk, et **`resetChunk` n'est pas documenté** dans l'API Reference. Voir §3.10. |
| `api.getVariation` | `getVariation() → string` | Uniquement pour nommer la clé de persistance si plusieurs variations partagent un lobby. |
| `api.blockCoordToChunkId`, `api.chunkIdToBotLeftCoord` | conversion position ↔ chunk | Calcul des chunks à surveiller autour d'une salle. |
| `api.getPosition` | `getPosition(entityId) → [x, y, z]` | Position du joueur pour le suivi et les priorités. |
| `api.setPosition` | `setPosition(entityId, x, y, z)` ou `(entityId, [x,y,z])` | Téléportation vers le spawn du donjon (code existant, inchangé). |
| `api.getPlayerIds` | `getPlayerIds() → PlayerId[]` | Boucle de suivi des joueurs. |
| `api.getPlayerDbId` | `getPlayerDbId(playerId) → PlayerDbId` | Clé de persistance stable du Mode B (« *a permanent identifier that doesn't change when leaving and re-entering* »). |
| `api.getPlayerIdFromDbId` | `getPlayerIdFromDbId(dbId) → PNull<PlayerId>` | Retrouver un joueur en ligne depuis une clé persistée. |
| `api.getLobbyName` | `getLobbyName() → string` | Clé de persistance du Mode A. |
| `api.getLobbyDbValue` / `api.setLobbyDbValue` | `key`, `value: string \| number` | Mode A. |
| `api.getPlayerDbValue` / `api.setPlayerDbValue` | `playerId`, `key`, `value: string \| number` | Mode B. |
| `api.deleteLobbyDbValue` / `api.deletePlayerDbValue` | `key` (+ `playerId`) | Suppression ciblée d'un fragment, migration. |
| `api.now` | `now() → number`, « *Date.now() value saved at start of current game tick* » | **Jamais utilisé pour mesurer une durée** : la valeur est figée pendant tout le tick. |
| callback `tick` | `tick = (ms) => {}`, « *Called every tick, 20 times per second* » | Unique horloge du moteur. `ms` est le pas fixe documenté. |
| callback `doPeriodicSave` | « *You should save custom db values/s3 objects here* » | Point de sauvegarde périodique. |
| callback `onClose` | `onClose(serverIsShuttingDown)` | Sauvegarde de fermeture. |
| callback `onPlayerChangeBlock` | `(playerId, x, y, z, fromBlock, toBlock, droppedItem, fromBlockInfo, toBlockInfo, dropsPrevented)` | Capture d'une modification **avant** que le bloc soit posé : `fromBlock` et `toBlock` sont tous deux fournis. |
| callback `onWorldChangeBlock` | `(x, y, z, fromBlock, toBlock, initiatorDbId, extraInfo, dropsPrevented)` | Filet de sécurité pour les changements de bloc non initiés par un joueur (`extraInfo.cause`). `initiatorDbId` vaut `null` pour du code de jeu. |
| callback `onPlayerJoin` / `onPlayerLeave` | voir doc | Chargement/déchargement des données de joueur, allocation d'origine, réapplication des protections. |
| callback `onPlayerRequestChunk` | `(playerId, chunkX, chunkY, chunkZ, chunkId)` | Connaissance des chunks demandés par un joueur. |
| `api.setCantChangeBlockRect` | `(playerId, pos1, pos2)` | Protection optionnelle de la coque du donjon. La doc avertit que `setCantChangeBlock` sur des milliers de blocs provoque du lag et conseille les variantes `Rect`/`Type`. |
| `api.setCallbackValueFallback` | `(cbName, value)` | Valeur de repli par défaut si un callback lève une erreur. |
| `api.log` | voir « Getting started » | Journalisation d'erreur, jamais dans une boucle chaude. |
| `@plugins/helpers` | `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `forceLoadChunk`, `randomInt`, `shuffleArray`, `getRandomItem` | Non utilisés : le projet a déjà son scheduler piloté par `tick` (`src/utils/scheduler.js`), plus testable hors Bloxd et sans dépendance. `forceLoadChunk` est noté comme piste si le chargement de chunk devient un goulot. |

---

## 3. Limites de la plateforme et leurs conséquences

Ces points ne sont pas des détails : chacun a orienté une décision d'architecture.

### 3.1 Les DBValues n'acceptent qu'une chaîne ou un nombre

`setLobbyDbValue(key, value)` et `setPlayerDbValue(playerId, key, value)` n'acceptent que `string | number`. **Conséquence :** tout l'état passe par une sérialisation JSON maison (pas de dépendance à `JSON`, voir §3.6) et tout le budget de stockage se compte en **caractères de la chaîne**.

### 3.2 La limite de longueur des DBValues n'est pas documentée

La documentation officielle ne donne aucun chiffre. La seule mention est indirecte, dans `setCurrency` : « *Persistent currencies count towards db length limits* ». Il existe donc bien une limite, mais sa valeur n'est nulle part dans les pages consultées.

**Conséquence, et c'est une contrainte structurante :** le moteur ne doit jamais supposer disposer de beaucoup de place. Il est conçu autour d'un **comptable de budget** : chaque écriture mesure la longueur exacte de la chaîne avant de l'envoyer, et refuse ou compacte au-delà d'un seuil configurable (`dbCharBudget`). Aucune architecture ne dépend d'une limite supposée.

### 3.3 `getBlockSolidity` ne distingue pas « non chargé » de « plein »

« *Will be true if the block is unloaded.* » Un `true` peut donc signifier un mur **ou** un chunk absent.

**Conséquence :** la validation des collisions ne lit **jamais** le monde. Elle se fait intégralement sur le modèle logique, en mémoire. Le monde n'est lu qu'après écriture, pour vérifier, et toujours accompagné de `isBlockInLoadedChunk`.

### 3.4 Écrire avant que le chunk soit chargé perd les écritures

Déjà observé et corrigé sur le code existant (`chunkWarmupTicks = 3`, `45d7d93`). La doc confirme que `onChunkLoaded` n'est pas un endroit où écrire durablement.

**Conséquence :** c'est une **précondition du constructeur**, pas une option. `Builder.canBuild(room)` exige : joueur téléporté, chunks du volume chargés (`isBlockInLoadedChunk` sur les coins et le centre), et au moins `chunkWarmupTicks` ticks écoulés depuis la première lecture du volume. Une salle qui échoue ce test reste `not_started` et est reportée, jamais marquée `failed`.

### 3.5 Aucune API de temporisation n'est documentée

Ni `setTimeout`, ni `setInterval`, ni `Promise`, ni `await`. `api.now()` est figé pendant le tick.

**Conséquence :** une seule horloge, `tick(ms)`, via le scheduler existant. Tous les budgets sont exprimés en **opérations par tick** et en **cycles de ticks**, jamais en millisecondes. C'est aussi ce qui rend les scénarios de charge mesurables : le coût est directement le nombre d'opérations consommées.

### 3.6 Les natives JavaScript ne sont pas garanties

Le projet s'interdit déjà `await` et les timers natifs. Par prudence, le moteur s'en tient à un noyau commun (objets, tableaux, `Map`, `Set`, arithmétique, `Math` sur entiers). Les chaînes sont manipulées par concaténation et découpage élémentaire. La sérialisation JSON est écrite à la main dans `Persistence` (encodeur/décodeur restreint à l'état du donjon), ce qui donne en prime un format compact et versionné.

> ⚠️ `Map` et `Set` sont utilisés par le code existant (`generator.js` utilise `Set`, `Object.keys`, `Array.from`), ils fonctionnent donc dans l'environnement cible. Les tests tournent sous Node.

### 3.7 Taille du code : 512 000 caractères

Le changelog officiel du 18 août 2026 annonce le passage de 64 k à 512 k caractères. Le moteur est donc écrit en modules séparés sous `src/` et assemblé par `tools/build-world-code.mjs`. **Conséquence de méthode :** le bundle doit rester lisible et modulaire ; on ne compresse pas les identifiants (déjà configuré), et on ne sacrifie pas la clarté à la place.

### 3.8 `setBlockData` ne peut pas servir de stockage

« *Data is cleared when block changes.* » Poser une donnée sur un bloc du donjon serait effacé au premier minage. **Conséquence :** aucune donnée de jeu n'est attachée aux blocs.

### 3.9 Aucun stockage externe documenté

`doPeriodicSave` mentionne « *custom db values/s3 objects* », mais **aucune fonction d'API pour S3 n'est documentée**. `setChunkAsSchematic` lit des schematics du projet dans l'éditeur : lecture seule, pas d'écriture runtime.

**Conséquence :** les seuls stockages disponibles sont les DBValues. La stratégie de persistance (§14) est donc bâtie sur elles, avec une échappatoire qui ne dépend pas d'elles : la **régénération depuis la seed**.

### 3.10 `resetChunk` est mentionné mais pas documenté

`getEmptyChunk` renvoie un `GameChunk` « *you can edit and set in resetChunk* », mais **`resetChunk` n'existe pas dans l'API Reference** ; seule `copyChunk` est documentée, et elle « *does nothing if the source chunk is not loaded* ».

**Conséquence :** l'écriture par chunks (une coque 32×32×32 en un appel, au lieu de milliers de `setBlock`) serait séduisante mais repose sur une fonction non documentée : elle est **écartée**. Le constructeur écrit bloc par bloc, ce que la doc encourage justement pour `setBlock` (« *optimised for setting broad swathes of blocks … in double nested loops* »). Si la Phase 4 montre que l'écriture bloc par bloc est le goulot, la piste `getEmptyChunk` + `resetChunk` sera rouverte, et seulement après vérification en jeu.

---

## 4. Vue d'ensemble des modules

Douze modules, regroupés en trois couches. Aucun module d'une couche basse n'importe une couche haute.

La liste a été révisée en Phase 1 par rapport à la proposition initiale : `DungeonModificationTracker` **disparaît** (les murs sont indestructibles, il n'y a rien à suivre — voir §15) et `Discovery` devient un module à part entière, parce que « chercher quoi générer » n'a ni le même déclencheur ni le même budget que « générer ».

```
┌──────────────────────────────────────────────────────────────────────┐
│ COUCHE Bloxd (seule à connaître api.*)                               │
│                                                                      │
│  DungeonController ──── horloge unique, orchestration des trois files│
│      │                                                               │
│      ├── PlayerTracker ──────── position, salle courante, priorités  │
│      ├── DungeonBuilder ─────── écriture des blocs, relecture, réparation
│      ├── DungeonBuildQueue ──── budget de blocs, curseur de reprise  │
│      └── DungeonPersistence ── DBValues, fragments, versions, reprise│
└──────────────────────────────────────────────────────────────────────┘
                    │  (interfaces en données simples)
┌───────────────────▼──────────────────────────────────────────────────┐
│ COUCHE LOGIQUE (aucun api.*)                                         │
│                                                                      │
│  DungeonManager ─── graphe : salles, ouvertures, connexions, commit  │
│      │                                                               │
│      ├── DungeonDiscovery ─── quelles ouvertures valent la peine     │
│      ├── DungeonGenerator ─── croissance par ouvertures, seeds        │
│      ├── DungeonConnector ─── appariement d'ouvertures, réutilisation│
│      ├── DungeonValidator ─── collisions réelles, passages, murs      │
│      └── DungeonSpatialIndex ─ régions + index d'ouvertures           │
│                                                                      │
│  DungeonGeometry ── cellules, formes, contours, conversions           │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────▼───────────────────────────────────────────────┐
│ COUCHE SUPPORT                                                       │
│  DungeonRecovery ── reprise après interruption, réparation, audit    │
└──────────────────────────────────────────────────────────────────────┘
```

| Module | Responsabilité unique | Ne fait jamais | État |
| --- | --- | --- | --- |
| `DungeonGeometry` | Formes en cellules, contours, dégagements, conversions logique/local/monde | Écrire, lire le monde | ✅ `src/dungeon/engine/geometry.js` |
| `DungeonShapes` | Grammaire de formes : produit un masque valide depuis une seed | Valider contre d'autres salles | ✅ `shapes.js` |
| `DungeonGenerator` | Croissance : produit une salle candidate depuis une ouverture parente | Valider, enregistrer | ✅ réparti entre `shapes.js` et `dungeonManager.expand` |
| `DungeonConnector` | Apparie deux ouvertures, réutilise une salle existante, décide du joint ou du pont | Générer une forme | ✅ `openings.js` + `tryReuse` |
| `DungeonValidator` | Fonction pure : accepte ou refuse une candidate, avec un code de refus | Modifier quoi que ce soit | ✅ `validator.js` |
| `DungeonSpatialIndex` | Requêtes de voisinage bornées et index d'ouvertures | Décider | ✅ `spatialIndex.js` |
| `DungeonManager` | Source de vérité du graphe, unique point de commit, profondeurs | Toucher au monde | ✅ `dungeonManager.js` |
| `DungeonDiscovery` | Position → quelles ouvertures sont imminentes, avec priorité | Générer | ✅ `discovery.js` |
| `DungeonQueues` | Les trois files, anti-doublons, ordre total | Décider quoi mettre dedans | ✅ `queues.js` |
| `PlayerTracker` | Position → salle → distance, profondeur, classe de priorité | Décider du budget | ✅ `locatePlayerRoom`, dans `discovery.js` |
| `DungeonController` | Boucle par tick, répartition des budgets, anti-cycles concurrents | Générer ni construire lui-même | ✅ `controller.js` |
| `DungeonBuilder` | D'un `RoomData` validé vers des blocs, dans l'ordre imposé | Décider *quoi* construire | ◻ Phase 4 |
| `DungeonBuildQueue` | File de construction, curseur de reprise, coût en blocs | Écrire des blocs | ◻ Phase 4 |
| `DungeonPersistence` | Sérialisation compacte, fragments, budget de caractères, versions | Décider du contenu | ◻ Phase 5 |
| `DungeonRecovery` | Rechargement, réparation, audit d'intégrité, reprise des constructions interrompues | Remplacer les autres modules | ◻ Phase 6 |

`DungeonBuildQueue` est séparé de `DungeonBuilder` parce que la reprise après interruption est un problème de **curseur persistant**, pas d'écriture : les deux ont des raisons de changer distinctes.

`DungeonDiscovery` est séparé de `DungeonGenerator` pour la raison inverse : la découverte lit des positions de joueurs à chaque tick et doit rester à coût quasi nul, alors que la génération fait de la géométrie et coûte cher. Les mélanger reviendrait à payer la géométrie à chaque tick.

---

## 5. Système de coordonnées

Trois repères, et une règle : **un seul module fait les conversions**.

| Repère | Unité | Origine | Qui l'utilise |
| --- | --- | --- | --- |
| `F_logical` | cellule entière | origine du donjon | Generator, Validator, Connector, SpatialIndex, Manager, files |
| `F_local` | bloc, relatif à une salle | coin min de la salle, au niveau du sol | construction, reconstruction, pose des pads |
| `F_world` | bloc Bloxd | monde | Builder, Persistence (via l'origine), PlayerTracker |

Conversions, toutes dans `DungeonGeometry` :

```
world  = dungeon.origin + logical * cellSize          // Y : originY + floorLevel * levelHeight
local  = logical - room.origin                        // 0..w-1, 0..h-1
logical = room.origin + local                         // retour
```

`cellSize` vaut 1 par défaut : une cellule logique est un bloc. Le paramètre existe pour qu'un futur passage à des cellules de 2 blocs ne demande pas de réécrire le générateur — seule `DungeonGeometry` change.

**Origine du donjon.** Chaque donjon reçoit une origine allouée une fois et persistée (`allocateOrigin`) : une case d'un anneau de pas `ORIGIN_STRIDE` (4096 blocs), compteur stocké dans la base. Cela garantit que deux donjons ne se chevauchent jamais, et que le donjon ne recouvre pas le lobby. Toutes les positions persistées sont **relatives à l'origine** (elles tiennent en peu de chiffres) ; l'origine est la seule valeur absolue stockée.

**Pourquoi c'est important pour la fiabilité :** le repère logique ne dépend d'aucun bloc. Toute la géométrie, toutes les collisions, tous les tests s'exécutent sans Bloxd. C'est ce qui rend possible l'exigence §9 — générer des centaines de salles en mémoire — et l'outil de visualisation sans blocs.

### 5.1 Identifiants d'entités : des chaînes

Les identifiants de session (`PlayerId`, `EntityId`) arrivent sous forme de **chaînes** (valeurs observées : `"-1"` pour un joueur, `"-192"` pour une entité). Ils sont utilisés partout comme clés de `Map`, jamais dans une comparaison numérique ni dans une addition. La seule clé persistée est `PlayerDbId` (§14.3), qui est stable, et `dungeonId` qui en dérive.

---

## 6. Structures de données versionnées

### 6.1 Schéma du donjon

```js
// Données procédurales (jamais modifiées par le joueur)
DungeonData = {
  version: 1,                  // schéma, pour la migration
  dungeonId: "L:arena-1",      // Mode A : L:<lobbyName> — Mode B : P:<playerDbId>
  seed: 1837462651,            // entier 31 bits, décide tout le donjon
  origin: { x: 4096, y: -1000, z: 4096 },   // seule position absolue stockée
  cellSize: 1,
  counters: { room: 812, connection: 903, opening: 0, op: 4107 }, // ids monotones
  rooms: { "r7": RoomData },   // index ; en pratique stocké en fragments (§14)
  connections: { "c19": Connection },
  buildStates: { "r7": "built" },   // séparé pour les mises à jour ciblées
  metadata: {
    createdAtTick: 0, savedAtTick: 120394,
    totalRooms: 812, totalConnections: 903,
    blockedOpenings: 14, suspendedRooms: 37,
    charBudgetUsed: 41230
  },
  modifications: { "r7": [Delta] }  // voir §15 ; en pratique en fragments séparés
}

RoomData = {
  id: "r7",
  seed: 1837462651,            // hash(dungeonSeed, parentRoomId, openingId)
  parentRoomId: "r3",          // null pour la salle d'entrée
  parentOpeningId: "r3.o1",    // l'ouverture qui a donné naissance à cette salle
  depth: 4,                    // arêtes depuis l'entrée, calculée au commit
  origin: { x: -36, z: 24 },   // coin min en F_logical
  floorLevel: 0,               // 0 = niveau du sol du donjon (extensible en étages)
  dimensions: { w: 6, h: 4, wallHeight: 4 },
  geometry: {                  // voir §7.3 — indépendant des blocs
    kind: "irregular",
    w: 6, h: 4,
    rows: ["111100", "111110", "011110", "000110"]   // '1' = cellule de la salle
  },
  openings: ["r7.o0", "r7.o1", "r7.o2", "r7.o3"],   // ids, dans l'ordre de création
  connections: ["c12", "c19"],
  buildState: "built",         // not_started | building | built | failed
  buildCursor: null,           // { phase: 4, index: 812 } pendant building
  integrity: { verifiedAt: 4102, repaired: 0 }
}

Opening = {
  id: "r7.o2",
  roomId: "r7",
  side: "east",                // north | east | south | west
  x: 6, z: 2,                  // cellule de la face extérieure, en F_logical
  offset: 2,                   // depuis le coin de la face, pour le contrôle d'espacement
  dir: [1, 0],                 // vecteur sortant
  width: 1,                    // ⩾ config.minPassageWidth
  height: 3,
  status: "connected",         // pending | reserved | connected | blocked
  connectionId: "c19",         // null sauf si connected
  failures: 0                  // tentatives échouées, pour passer à blocked
}

Connection = {
  id: "c19",
  a: "r7.o2",                  // toujours deux ouvertures identifiées
  b: "r12.o0",
  kind: "direct",              // direct (mitoyenne) | bridge (passage court explicite)
  width: 1, height: 3,
  cells: []                    // cellules de passage en F_logical, vide si direct
}
```

### 6.2 Règles de nommage et stabilité

- `roomId = "r" + base36(counter.room)`, `openingId = roomId + ".o" + base36(index)`, `connectionId = "c" + base36(counter.connection)`. Le compteur ne recule jamais, même après une suppression : un id n'est **jamais réutilisé**.
- Les ids ne dépendent pas de l'ordre d'exploration : ils dépendent de l'ordre de **création**, lequel est déterminé par la seed et par la file de découverte, pas par l'ordre d'arrivée des joueurs. Deux exécutions sur la même seed avec les mêmes points de départ produisent les mêmes ids.
- Un id persiste avec sa salle. Reconstruire une salle ne change ni son id ni sa seed.

### 6.3 Tailles mesurées

Mesuré sur les objets ci-dessus, sérialisés en JSON lisible, en caractères :

| Objet | Taille |
| --- | --- |
| `Opening` | 119 |
| `RoomData` (4 ouvertures, forme irrégulière) | 714 |
| `Connection` | 78 |
| ~~Un delta de modification~~ | ~~89~~ — supprimé, les murs sont indestructibles |
| 1 200 `RoomData` | ≈ 857 000 |

Une salle à 714 caractères ne tient pas dans un budget réaliste. Le format de **stockage** n'est donc pas le format en mémoire : `Persistence` encode une salle en **colonnes indexées** (tableaux parallèles, ouvertures en indices, forme en chaîne de bits, coordonnées relatives à l'origine en décimal court). Cible : **150 à 250 caractères par salle**, soit ~4 000 à 6 000 salles dans 1 M de caractères. La Phase 5 mesure le gain réel sur 1 000 salles et refuse la livraison si le facteur est inférieur à 3.

---

## 7. Formes procédurales et géométrie

### 7.1 Contrat

Une forme est un **ensemble de cellules** sur une grille `w × h`, avec `w, h ∈ [minDim, maxDim]`. Elle est indépendante des blocs : aucune forme ne dit « met un bloc de pierre ici ». C'est ce qui permet de tester la géométrie, de la visualiser en ASCII et de la sérialiser en quelques dizaines de caractères.

### 7.2 Grammaire de formes

**✅ Implémenté** dans `src/dungeon/engine/shapes.js`. Sept familles, toutes paramétriques, tirées par le RNG de la **tentative** et non par un compteur de passe (un tirage par `pass % 7` produisait 300 rectangles sur 300 — l'erreur est consignée dans `AUDIT-PHASE0.md`) :

| Famille | Construction |
| --- | --- |
| `rect` | rectangle `w × h` |
| `notch` | rectangle moins un renfoncement angulaire, asymétrique |
| `wings` | rectangle plus deux ailes opposées |
| `cross` | rectangle plus deux extensions opposées, débordantes |
| `extensions` | rectangle plus une à trois extensions latérales |
| `irregular` | rectangle mordu depuis son contour (profondeur ≤ 2, jamais un angle) |
| `narrow` | rectangle avec une partie étroite d'une cellule de large |

La grammaire est **extensible par construction** : une famille est une fonction qui reçoit `(random, width, height)` et remplit un masque. En ajouter une ne demande aucune modification du reste du moteur, et une famille qui produit une forme inutilisable est simplement refusée par la grille d'acceptation, pas par un cas particulier.

Chaque forme passe ensuite par une **grille d'acceptation**. Les refus sont des codes, jamais des exceptions :

1. `TOO_SMALL` — moins de 6 cellules : une salle où l'on ne peut pas se retourner.
2. `DISCONNECTED` — un remplissage depuis la première cellule n'atteint pas toutes les cellules.
3. `NO_WALKABLE_CORE` — aucune cellule de dégagement ≥ 1 : la salle serait un couloir de murs.
4. `PADDED` — le masque a une bordure vide (invariant de normalisation).
5. `DUPLICATE` — même forme déjà essayée pour cette salle.
6. `EXHAUSTED` — plus aucune famille productive : la tentative échoue proprement.

`sealHoles` est appliqué avant l'acceptation : une forme dont un trou d'une cellule subsiste serait une salle percée d'un puits, ce que le joueur lirait comme un bug.

### 7.3 Représentation

**✅ Implémenté.** Un masque est `{ w, h, cells }`, `cells[y][x]` valant `0` ou `1`. `toRows` / `fromRows` donnent la vue texte (une chaîne par ligne), qui sert aux tests et à la visualisation ASCII ; c'est le format qui apparaît dans tout diagnostic.

Taille maximale : `maxWidth × maxDepth = 11 × 11`, soit 121 cellules. Les contours, les dégagements et les cellules extérieures sont **dérivés** et jamais stockés.

Deux primitives remplacent la dilatation de la proposition initiale :

- `clearanceMap(mask)` donne, pour chaque cellule, la distance de Chebyshev au bord de la forme, en deux passes avant/arrière plus une passe de stabilisation. Elle sert à la fois de test d'accessibilité (dégagement ≥ 1) et de mesure de « largeur de passage » : c'est plus strict qu'une dilatation, parce qu'une diagonale n'y ouvre pas de passage ;
- `masksOverlap(a, originA, b, originB, margin)` teste les **cellules réelles**, marge comprise. Une marge de `m` exige `m` cellules vides entre les deux formes, ce qui est exactement ce que la maçonnerie demande. Une implémentation naïve à trois balayages donnait des dégagements non monotones ; c'est le genre d'erreur qui ne se voit qu'en regardant les nombres.

La « marge de sécurité » de la proposition initiale (`safetyMargin = 2`) **a été supprimée** : elle est incompatible avec l'adjacence voulue entre deux salles. Ce qui protège les salles l'une de l'autre, c'est le joint de `wallGap = 3` cellules, et lui seul (§8.3).

---

## 8. Ouvertures

### 8.1 Cycle de vie

```
                    ┌──────────── plan de la salle ────────────┐
                    ▼                                          │
   pending ──reserve──▶ reserved ──succès──▶ connected           │
      ▲                    │                    │               │
      │                    └──échec──┐          │               │
      │                              ▼          │               │
      └──── cooldown ─────────── pending        │               │
                                   │            │               │
                          failures ≥ maxOpenAttempts             │
                                   ▼            │               │
                                blocked ◀───────┘ (connexion retirée)
```

- `pending` : disponible, jamais tentée, ou revenue après un échec.
- `reserved` : **transitoire, jamais persisté**. N'existe que pendant la durée d'une transaction. Si le processus meurt à cet instant, aucune donnée n'a été écrite : l'ouverture est toujours `pending` au rechargement.
- `connected` : une `Connection` réelle la référence.
- `blocked` : après `maxOpenAttempts` (défaut 3) échecs **de causes différentes** ou après expiration du cooldown. L'ouverture reste dans les données, avec son motif, et n'est plus retentée. Elle ne bloque jamais la salle : une salle dont une ouverture est `blocked` est parfaitement valide.

**Annulation de réservation.** Une transaction qui échoue appele `release(openingId)`, qui remet `pending` et décrémente `failures`. Aucune écriture disque n'a eu lieu à ce stade, donc l'annulation est triviale et totale. C'est le point où beaucoup d'implémentations fuient : ici, il n'y a rien à défaire parce qu'on n'a rien fait.

### 8.2 Règles de placement

**✅ Implémenté** dans `planOpenings(roomId, mask, seed)` (`openings.js`). Une ouverture n'est créée que si :

1. Les **cellules qu'elle perce sur la face** sont toutes sur le **contour réel** de la forme. Une ouverture sur une morsure ouvrirait dans le vide : le contrôle porte sur toute la largeur du seuil, pas seulement sur sa cellule centrale — c'est une erreur qui a réellement eu lieu.
2. Elle n'est pas dans un angle : `offsetStart ≥ minCornerClearance` et `offsetEnd ≤ faceLength - 1 - minCornerClearance`.
3. Elle est à `≥ minOpeningSpacing` de toute autre ouverture de la même face, après tri des candidats.
4. La cellule immédiatement **derrière** le seuil appartient à la forme : on peut s'y tenir, et le validateur le revérifie.
5. Sa hauteur plus le linteau tient sous le plafond : `height + 1 ≤ wallHeight`.

Le nombre d'ouvertures n'est **pas** constant : il dépend du périmètre (`perimeter / cellsPerOpening`), borné par `[minOpenings, maxOpenings]`. En pratique, 2 à 5 ouvertures par salle, 3,3 en moyenne sur 300 formes — un donjon où chaque salle a exactement deux portes serait un couloir déguisé.

Le choix des positions se fait par **score plus pénalité de diversité** : chaque segment exploitable du contour est noté (longueur, éloignement des angles, éloignement des ouvertures déjà posées), un tirage pondéré sélectionne, puis les positions retenues sont espacées. Deux ouvertures ne se retrouvent donc pas collées l'une à l'autre par hasard.

### 8.3 Géométrie du joint — la constante unique

**Décision figée : `wallGap = 3` cellules de maçonnerie entre deux salles voisines.** C'est la valeur voulue par le propriétaire du projet (« 3 blocks est bien »). Si l'intention était un autre découpage, `DUNGEON_CONFIG.wallGap` est le seul paramètre à changer : rien d'autre dans le moteur ne code une distance en dur.

Ce que « 3 » signifie exactement, parce que trois conventions ont déjà coexisté et produit zéro boucle détectée :

```
   salle A        joint        salle B
 [ ...mur A ] [ . . . ] [ mur B... ]
              ^ 3 cellules de maçonnerie
```

- les deux façades sont distantes de `wallGap + 1` cellules d'axe à axe de seuil, donc de `wallGap` cellules de joint entre les deux bords ;
- les **cellules centre des deux ouvertures sont distantes de `wallGap + 2`** ;
- les cellules **entre** les deux seuils, joint compris, valent `wallGap` : ce sont celles que `jointCells` renvoie et que le constructeur creuse.

Le décalage constant entre ces trois formules est exactement le genre d'erreur qui ne casse rien visiblement : les salles sont belles, mais aucune boucle n'est jamais détectée. Une seule source de vérité, `wallGap`, et un test qui recompte les cellules une par une (`tests/engine/index.test.js`, « wallGap is honoured by every committed connection »).

### 8.4 Largeur de passage uniforme

`minPassageWidth = maxPassageWidth = 1`. Une largeur unique n'est pas une simplification esthétique : deux salles dont les seuils n'ont pas la même largeur ne peuvent **jamais** se raccorder, et avec un tirage 1 ou 2 cellules, la moitié des paires devenait incompatible. Passer à une largeur unique a fait chuter les refus `DOOR_MISMATCH` de ~45 % à ~5 % des candidats. Élargir à 2 reste possible : c'est un paramètre, et il faudra alors que l'appariement accepte les seuils de largeur différente.

---

## 9. Algorithme de génération par ouvertures

### 9.1 Seeds déterministes

```
roomSeed = hash32(dungeonSeed, parentRoomId, openingId)      // FNV-1a 32 bits sur "seed|parent|opening"
attemptSeed = hash32(roomSeed, attemptIndex)                 // une tentative = un tirage indépendant
rng = mulberry32(attemptSeed)                                // générateur local, jamais partagé
```

Aucun état global, aucun compteur partagé. Conséquences directes :

- rejouer la même tentative donne exactement la même forme, donc une validation qui échoue échoue **toujours** au même endroit — pas de test instable ;
- une salle peut être régénérée à l'identique depuis sa seule seed, ce qui est le pilier de la stratégie de persistance (§14.5) ;
- l'ordre d'exploration n'influence pas la géométrie, seulement l'ordre de création des ids.

### 9.2 Croissance

**✅ Implémenté** (`dungeonManager.expand`). Une salle ne naît que d'une ouverture `pending` d'une salle existante.

```
expand(roomId, openingId):
  refus si l'ouverture n'est pas pending            → NOT_PENDING
  // 1) une boucle ou un raccourci ne coûte rien et ne consomme aucun budget
  connexion = tryReuse(room, opening)               → si trouvée, commit, terminé
  // 2) sinon, une salle neuve alignée sur cette ouverture
  pour attempt = 0 .. maxGenerationAttempts-1:
    shape   = generateShape(roomSeed(seed, room, opening), attempt)
    planned = planOpenings(shape)
    seuils  = ouvertures du côté opposé, de même largeur   → sinon DOOR_MISMATCH
    origin  = placeRoomForOpening(room, opening, shape, seuil)
    verdict = validateRoom({ candidate, nearby: index.queryRect(...), parent, clearances })
    si ok: commitRoom + commitConnection + refreshDepths + closeLoops, terminé
  opening.failures += 1
  si failures ≥ maxGenerationAttempts: opening.status = blocked
  retour { ok:false, code: <dernier refus réel>, blocked, attempts }
```

Quatre points qui ont coûté du temps et méritent d'être écrits :

- **Aucune connexion par simple proximité.** Une connexion `direct` exige que les deux seuils se fassent face, à la distance exacte du joint, sur le même axe. Une connexion `bridge` est une décision distincte, avec ses propres cellules stockées (§9.4).
- **Réutilisation.** `tryReuse` interroge l'index d'ouvertures sur la cellule visée par la normale de l'ouverture développée. S'il y a déjà une ouverture `pending` d'une autre salle exactement face à elle, on les connecte : c'est une boucle ou un raccourci, qui ne crée aucune salle et ne consomme aucun budget de génération.
- **Le refus réel est remonté, pas le fait que les tentatives sont épuisées.** Renvoyer `EXHAUSTED` masquait `COLLISION_CELL` dans tout diagnostic : le visualiseur affichait 27 « tentatives épuisées » et zéro collision alors que les collisions étaient la seule cause. Un refus qui ne dit pas pourquoi est un refus inutilisable.
- **Budget.** Un échec, une réutilisation ou une ouverture déjà connectée ne consomment rien ; seule une salle effectivement créée compte.

### 9.3 Boucles, raccourcis et profondeurs

**✅ Implémenté.** `DungeonManager` tient le graphe. Après chaque commit :

- le `depth` du nouveau nœud est recalculé depuis l'entrée, par un BFS borné à la composante affectée ;
- `closeLoops(room)` est appelé après chaque salle créée : c'est le seul moment où une ouverture de la nouvelle salle peut trouver un partenaire déjà posé. Chercher des boucles uniquement au moment d'`expand` ne suffit pas, parce que les deux ouvertures doivent être développées dans le bon ordre — et il n'y a pas de « bon ordre » dans un graphe ;
- `openings disponibles d'une salle` = `pending` ; `neighbours` = salles reliées ; les ouvertures `pending` se lisent dans l'index, pas en parcourant les salles.

Mesures sur le moteur actuel (150 salles, quatre seeds, `npm run visualize`) :

| Seed | Connexions | Ponts | Boucles | Culs-de-sac | Profondeur max | Ouv. libres |
| --- | --- | --- | --- | --- | --- | --- |
| 12345 | 155 | 4 | 6 | 57 | 8 | 264 |
| 777 | 152 | 2 | 3 | 57 | 9 | 276 |
| 2024 | 152 | 3 | 3 | 57 | 8 | 264 |
| 5150 | 154 | 5 | 5 | 51 | 8 | 268 |

Lecture : un arbre de 150 salles aurait 149 arêtes ; on en a 152 à 155, donc **de vraies boucles**, et environ un tiers des salles sont des carrefours à trois ou quatre voisins. Les 265 ouvertures encore libres sont exactement ce que demande le cahier des charges : toute ouverture non utilisée reste disponible pour une exploration ultérieure.

### 9.4 Deux natures de connexion

**✅ Implémenté.**

| Nature | Quand | Ce qui est stocké | Coût en salles |
| --- | --- | --- | --- |
| `direct` | deux seuils alignés à `wallGap + 1` d'axe à axe | les `wallGap` cellules du joint, recalculables depuis les deux ouvertures | 1 salle neuve (ou 0 en réutilisation) |
| `bridge` | deux seuils alignés mais plus éloignés, dans la limite `maxBridgeLength` | les cellules du pont, explicitement | 0 |

Un pont n'est jamais deviné : `bridgeCells` refuse tout ce qui n'est pas rectiligne, de même largeur, dans la limite de longueur, et le gestionnaire vérifie qu'aucune troisième salle ne se trouve sur le trajet. C'est ce qui permet des raccourcis sans transformer le moteur en recherche de chemin, qui serait une source de bugs bien plus grande que le bénéfice.

### 9.5 Identité et ordre d'exploration

**✅ Implémenté.** L'identité d'une salle est **dérivée de son chemin** : `r0.0.2` est la salle atteinte par l'ouverture `o2` de la salle `r0.0`, elle-même atteinte par `o0` depuis l'entrée `r0`. Une connexion est nommée par la paire triée de ses deux ouvertures, `c:<oa>+<ob>`.

Ce n'est pas une coquetterie. Avec des identifiants attribués par un **compteur**, la seed d'une salle dépendait de son rang de création, donc de l'ordre dans lequel les ouvertures étaient développées : la même seed de donjon produisait un donjon **différent** selon l'ordre des ticks, ce qui ruinait la promesse « le retour en arrière reconstruit la même géométrie ». Le compteur est conservé comme statistique, mais il ne nomme plus rien.

Ce que cette règle garantit, et ce qu'elle ne garantit pas :

- **garanti** : une salle donnée a toujours la même position, la même forme et les mêmes ouvertures, qu'on la construise en deuxième ou en centième ;
- **non garanti** : deux ordres d'exploration différents ne visitent pas les mêmes salles, puisque la file n'avance pas de la même façon. C'est normal et sans conséquence : ce qui compte est qu'une salle déjà construite soit toujours la même.

---

## 10. Validation et atomicité

### 10.1 Codes de refus

**✅ Implémenté** (`REFUSAL` dans `validator.js`, plus les codes du gestionnaire). Le validateur renvoie un objet, jamais un booléen : le diagnostic sert au visualiseur, aux statistiques et aux tests.

```js
{ ok: false, code: "COLLISION_CELL", detail: { roomId: "r12", at: { x: 34, y: 12 } } }
```

| Code | Cause | Émetteur |
| --- | --- | --- |
| `OUT_OF_BOUNDS` | hors du rayon maximal du donjon | validateur |
| `NO_OPENING` | la candidate n'a aucune ouverture | validateur |
| `OPENING_NOT_ON_CONTOUR` | une cellule du seuil n'est pas sur le contour réel | validateur |
| `OPENING_IN_CORNER` | marge d'angle insuffisante | validateur |
| `OPENING_NO_APPROACH` | la cellule derrière le seuil n'appartient pas à la forme | validateur |
| `COLLISION_CELL` | une cellule **réelle** de la candidate heurte une autre salle | validateur |
| `NO_CLEARANCE` | le vide entre deux salles est plus étroit que la maçonnerie demandée | validateur |
| `DOOR_MISMATCH` | largeur, alignement ou sens incompatibles | validateur + gestionnaire |
| `NO_WALKABLE_PATH` | le passage ne relie pas réellement les deux intérieurs | validateur |
| `ROOM_DISCONNECTED` | les ouvertures de la nouvelle salle ne se rejoignent pas à pied | validateur |
| `TOO_SMALL`, `DISCONNECTED`, `NO_WALKABLE_CORE`, `PADDED`, `DUPLICATE`, `EXHAUSTED` | la forme elle-même a été refusée par la grammaire | `shapes.js` |
| `NOT_PENDING` | on a tenté de développer une ouverture déjà connectée ou bloquée | gestionnaire |
| `DUPLICATE_PENDING` | la même ouverture a déjà été demandée en parallèle | gestionnaire |
| `NO_FREE_SPACE` | aucune tentative n'a produit de salle acceptée | gestionnaire |

`OPENING_TOO_CLOSE`, `DOOR_NO_CLEARANCE` et `BELOW_MIN_HEIGHT` ont été retirés de la liste : l'espacement est garanti à la création (il n'est jamais constaté au moment de la validation), la marge de sécurité n'existe plus (§7.3), et la hauteur de passage est contrôlée par le catalogue de blocs, pas par le validateur.

### 10.2 Ordre des contrôles

**✅ Implémenté.** Du moins cher au plus cher, avec sortie anticipée :

1. `NO_OPENING` — liste vide, une comparaison.
2. `OUT_OF_BOUNDS` — quatre comparaisons sur la boîte englobante.
3. `OPENING_NOT_ON_CONTOUR`, `OPENING_IN_CORNER`, `OPENING_NO_APPROACH` — sur les ouvertures, coût proportionnel à leur nombre (≤ 5).
4. `COLLISION_CELL` — collisions réelles contre les seules salles renvoyées par l'index.
5. `DOOR_MISMATCH` — largeur et sens des deux seuils.
6. `ROOM_DISCONNECTED` — parcours sur cellules marchables, le plus cher, donc en dernier.

Le validateur ne modifie rien : c'est une fonction pure de `(candidate, nearby, parent, radius, clearances)`. C'est ce qui rend l'atomicité triviale — il n'y a rien à défaire quand on n'a rien fait.

### 10.3 Collisions réelles, pas rectangles englobants

**✅ Implémenté.** Deux formes en L peuvent avoir des rectangles englobants qui se chevauchent sans qu'aucune cellule ne se touche. Le validateur ne compare donc jamais des boîtes :

1. `index.queryRect(grownRect(mask, origin))` → quelques salles candidates seulement, jamais l'ensemble du donjon.
2. Pour chaque candidate : `masksOverlap(mask, origin, otherMask, otherOrigin, structureMargin)` teste les **cellules réelles**, restreint à l'intersection des boîtes, avec sortie au premier conflit.
3. La marge est exprimée en cellules vides, pas en dilatation : c'est plus simple à raisonner et impossible à confondre avec un décalage.

Deux tests couvrent les **deux** sens : deux L dont les boîtes se chevauchent mais pas les cellules doivent être acceptées (§`geometry.test.js`) ; deux salles dont une cellule est commune doivent être refusées, avec la cellule en détail.

### 10.4 Pourquoi il n'y a pas de « marge de sécurité »

La proposition initiale prévoyait `safetyMargin = 2` et une soustraction du rectangle de passage pour ne pas fermer les portes.

Cette complexité est **supprimée**. Deux salles raccordées sont, par construction, séparées par exactement `wallGap` cellules de maçonnerie ; il n'y a jamais de contact. Ajouter une marge obligeait à traiter le joint comme une exception, et l'exception finissait toujours par fermer une porte quelque part. Le joint est désormais la seule règle (§8.3), et `structureMargin = 0` est un paramètre qui existe pour les cas où l'on voudrait volontairement plus d'air — il est mesuré : à 3, il ne crée aucune boucle supplémentaire et ne fait que refuser des salles.

### 10.5 Atomicité et tentatives

**✅ Implémenté, avec une nuance.**

```
expand():          le validateur ne touche à rien ; l'origine et le masque sont locaux
commitRoom()       seul point d'entrée d'une salle dans le graphe
commitConnection() seul point de mutation des statuts d'ouverture, de l'index et du graphe
```

Une salle n'entre dans le graphe qu'après validation complète, par `commitRoom`, immédiatement suivie de `commitConnection`. Une tentative refusée ne laisse **aucune** trace : ni salle, ni ouverture orpheline, ni entrée d'index. C'est vérifié par un test qui compare l'état complet du donjon avant et après un refus (`tests/engine/graph.test.js`, « a refused expansion leaves no trace at all »).

**La nuance.** La proposition initiale décrivait un objet de transaction `begin/reserve/commit/rollback`. L'implémentation n'en a pas besoin : comme la génération est une fonction pure et synchrone, l'état intermédiaire n'existe que sur la pile d'appel. Un objet de transaction aurait ajouté un état à nettoyer — exactement le genre d'état dont un plantage laisse une trace. La réservation explicite d'ouverture reste utile en Phase 3, où deux requêtes concurrentes peuvent viser la même ouverture ; elle sera introduite là, avec ses tests, et pas avant.

## 11. Index spatial

**✅ Implémenté** (`spatialIndex.js`). Deux structures, toutes deux en `Map`.

**Grille de régions pour les salles.** `REGION_SIZE = 16` cellules (et non 32 : nos salles font au plus 11 cellules de côté, une région de 16 contient donc une salle et son voisinage immédiat, alors qu'une région de 32 aurait fait tenir 3×3 salles dans chaque case). Une salle est enregistrée dans toutes les régions que couvre sa boîte. `queryRect(rect)` renvoie l'union des salles des régions touchées, dédupliquée. Insertion et suppression coûtent O(régions touchées), soit 1 à 4 pour une salle de 11×11.

**Index des ouvertures.** Clé = cellule **centre de l'ouverture, sur la face de sa propre salle**, plus son côté. Une requête « y a-t-il une ouverture face à la mienne ? » lit la case située à `wallGap + 1` dans la normale : une seule lecture de `Map`.

Le choix de la clé est le point délicat, et il a été faux deux fois :

- clé sur la cellule **extérieure** de l'ouverture : deux ouvertures qui se font face ne partagent jamais cette cellule, donc zéro boucle détectée ;
- clé juste, mais distance de recherche fausse (`wallGap`, `wallGap + 2`, `wallGap + 4` essayés) : les paires existaient, l'index ne les trouvait pas. La bonne valeur est `wallGap + 1`, parce que le centre d'une ouverture **est** une cellule de la face de sa salle : entre deux faces séparées par `wallGap` cellules de joint, il y a `wallGap + 1` cellules d'écart entre les deux centres.

Pour les ponts, `openingsInRect(rect, excludeRoomId)` renvoie les ouvertures `pending` d'un petit rectangle **orienté selon la normale** de l'ouverture (et non un carré autour d'elle, qui ramènerait aussi des paires latérales). La portée est `wallGap + 1 + maxBridgeLength`, donc le coût ne dépend jamais du nombre de salles.

Ce que l'index ne fait pas : décider. Il ne renvoie que des candidats ; c'est le validateur qui tranche, en collisions réelles.

Deux tests de propriété le vérifient (`tests/engine/index.test.js`) :

- sur trois seeds et jusqu'à 120 salles, l'index trouve **toutes** les paires qu'une implémentation de référence en O(n²) trouve — un sur-ensemble, jamais un sous-ensemble ;
- le coût par salle ne croît pas avec la taille du donjon : le rapport mesuré entre 60 et 200 salles doit rester sous un facteur 4, alors qu'il vaudrait 3,3 en O(n).

Sans ces tests, une erreur d'index se traduirait par des murs qui se croisent en jeu, très loin de sa cause.

---

## 12. Anticipation : les trois opérations et les trois files

**✅ Implémenté** dans `discovery.js`, `queues.js` et `controller.js`.

### 12.1 Trois opérations distinctes

| Opération | Entrée | Sortie | Coût | Consomme un budget de génération ? |
| --- | --- | --- | --- | --- |
| **Découverte** | position d'un joueur, salle courante | ouvertures `pending` à `≤ 30` blocs → `discoveryQueue` | très faible | non |
| **Génération logique** | une ouverture | salle validée + connexion enregistrées | moyen | oui, 1 par salle créée |
| **Construction** | une salle `not_started` | blocs dans le monde | élevé, mesuré en blocs | budget de blocs distinct |

Séparer les trois est ce qui permet de répondre à « le joueur arrive dans une salle qui n'existe pas » : la découverte et la génération vont plus vite que la construction, donc on peut toujours avoir un graphe en avance et une construction qui rattrape.

### 12.2 Déclencheurs

| Déclencheur | Paramètre | Effet |
| --- | --- | --- |
| Approche | `discoveryDistance = 30` | une ouverture libre à moins de 30 cellules du joueur entre en file |
| Franchissement imminent | `crossingDistance = 6` | classe `crossing` : servie avant tout le reste, quelle que soit la distance des autres |
| Profondeur | `anticipationDepth = 3` | on explore le graphe jusqu'à 3 arêtes **sur toutes les branches** |
| Éloignement | `maxAnticipationDistance = 96` | aucune salle plus loin n'est même regardée |

Les trois déclencheurs sont indépendants et se cumulent : un joueur immobile voit quand même ses branches s'ouvrir, et un joueur qui court est servi devant lui.

### 12.3 Priorité

```
class    = crossing ? 0 : 1
priority = distance + depth * 40
```

`depth` est le nombre d'arêtes depuis la **salle du joueur**, pas depuis l'entrée : un joueur descendu à dix salles ne doit pas être affamé par un joueur resté près de l'entrée.

L'exemple chiffré du cahier des charges (A 120, C 250, B 8148, D 5285 ⇒ **A, C, D, B**) est un test unitaire (`tests/engine/discovery.test.js`).

La distance est mesurée à la **cellule la plus proche du seuil**, pas à son milieu : un seuil fait jusqu'à cinq cellules de large, et un joueur debout à l'extrémité d'un seuil large paraîtrait sinon plus loin qu'il ne l'est.

### 12.4 Trois files

| File | Clé d'unicité | Contenu | Budget |
| --- | --- | --- | --- |
| `discovery` | `roomId/openingId` | ouvertures à évaluer | `maxDiscoveryPerCycle = 40` |
| `generation` | `roomId/openingId` | ouvertures à développer | `maxRoomsPerCycle = 10`, `maxGenerationPerCycle = 24` tentatives |
| `build` | `roomId` | salles validées à construire | `maxBlocksPerTick = 800` |

Chaque file est une liste plus une `Map` d'appartenance : l'anti-doublon est une lecture de `Map`, jamais un parcours. Pousser une entrée déjà présente la **met à jour** au lieu de la dupliquer, ce qui sert le seuil à sa nouvelle priorité quand le joueur s'en approche, et empêche deux joueurs de faire générer la même salle au même tick.

Une file est une **indication**, pas une autorité : le graphe l'est. Une entrée dont l'ouverture a été connectée entre-temps est ignorée, pas forcée.

### 12.5 Contrôle de fréquence et gestion du retard — **mesuré**

```js
controller.tick()   // appelé depuis le scheduler du jeu, une fois par tick
```

`tick()` compte, et exécute un **cycle** tous les `cycleTicks = 20` ticks (une seconde). Un cycle réentrant est **refusé**, pas mis en file : deux cycles qui se disputent la même ouverture, c'est exactement ainsi qu'une salle est générée deux fois. Le refus est compté (`stats.deferred`).

Mesures (`npm run simulate`, builder qui coûte `w × h` blocs par salle) :

| Scénario | Salles | Cycles | Médiane par cycle | p99 | Max |
| --- | --- | --- | --- | --- | --- |
| 1 joueur qui marche | 39 | 200 | 0,02 ms | 0,76 ms | 22 ms (2e cycle) |
| 6 joueurs qui marchent | 39 | 200 | 0,03 ms | 0,9 ms | 16 ms en régime |
| 6 joueurs immobiles | 31 | 200 | 0,02 ms | 0,6 ms | 8,7 ms |

Les pics des premiers cycles ne sont pas la charge de travail : un cycle coûte 80 à 90 % de son temps en **génération**, et seuls les premiers cycles ont quelque chose à générer. Un donjon déjà rempli passe à 0,02 ms. L'important est que le **travail par cycle soit borné par le budget** : c'est vérifié par un test qui compte les tentatives, pas par un chronomètre — une assertion de temps serait instable sur une machine chargée.

### 12.6 Anti-cycles concurrents

Un seul contrôleur par donjon, un indicateur `cycleRunning`, un `try/finally` qui le relâche même si un builder lève. Un test fait sciemment rappeler `cycle()` depuis l'intérieur d'un builder et vérifie que le second appel est refusé et que le contrôleur n'est pas resté verrouillé : c'est le genre de verrou qu'on ne remarque qu'après un blocage en production.

### 12.7 Salle suspendue plutôt que salle perdue

Quand la file de construction dépasse `backlogThreshold`, les salles qu'aucun joueur n'approche à moins de `suspendDistance` (96) sortent de la file. Elles **restent dans le graphe** : leurs ouvertures restent disponibles, et elles reviennent dès qu'un joueur s'en approche. Supprimer une salle du graphe pour la retrouver plus tard serait une perte de branche, pas une optimisation.

### 12.8 Ce que le contrôleur ne fait pas

- il ne lit aucun bloc, n'écrit aucun bloc ;
- il ne connaît ni `api.*` ni le scheduler du jeu : c'est l'hôte qui appelle `tick()` ;
- il ne persiste rien : les files sont reconstruites depuis le graphe et les joueurs après un redémarrage, ce qui est précisément ce qu'on veut puisqu'elles ne contiennent que du travail à refaire.

---

## 13. Construction physique

### 13.1 Préconditions

Rien n'est écrit tant que :

1. la salle est validée et enregistrée (`buildState = not_started`) ;
2. le joueur est **téléporté** et le chunk du spawn a été réparé (code existant, inchangé) ;
3. `isBlockInLoadedChunk` est vrai sur les quatre coins du volume et sur son centre ;
4. `chunkWarmupTicks` ticks (3) se sont écoulés depuis la première lecture du volume.

Si une précondition manque, la salle est reportée, pas abandonnée.

### 13.2 Ordre imposé, et pourquoi

| Phase | Action | Raison |
| --- | --- | --- |
| 1 | dégagement du volume (`Air` du sol au plafond) | idempotence : une reconstruction repart propre |
| 2 | sol : toutes les cellules de la forme | on marche avant d'avoir des murs |
| 3 | **murs par segments de contour**, en sautant les cellules de passage | le mur n'est jamais plein puis percé |
| 4 | encadrement et linteau des passages | le passage est structurel, pas un trou |
| 5 | plafond | ferme le volume, ne bloque rien |
| 6 | **pose du pad** de difficulté, si la salle en porte un | après la géométrie, sur une cellule de sol connue (§15.2) |
| 7 | vérification : relecture d'un échantillon déterministe | ne jamais faire confiance à une écriture |

La phase 3 s'appuie sur `contourSegments` calculé à la génération : le constructeur ne redécouvre pas les murs, il les reçoit. Une cellule qui appartient au rectangle de passage d'une ouverture `connected` **n'est jamais écrite** comme mur : elle est tout simplement absente de la liste.

### 13.3 Construction progressive et reprise

Le constructeur est un **générateur** qui produit des lots de blocs (`buildRoomBatch(room, cursor)`), le curseur étant persisté dans `RoomData.buildCursor`. Interrompre au milieu d'une salle ne perd rien :

- chaque bloc écrit est écrit de façon idempotente (réécrire la même valeur est sans effet) ;
- le curseur avance **après** écriture, donc une coupure entre les deux provoque au pire de réécrire un lot déjà écrit, jamais d'en sauter un ;
- au rechargement, `DungeonRecovery` reprend les salles `building` à leur curseur, et rejoue `not_started` depuis zéro.

Le curseur est enregistré par la persistance groupée, pas à chaque bloc : la granularité est un lot, ce qui borne le coût d'écriture en base à `blocksPerShardWrite` blocs plutôt qu'à un bloc.

### 13.4 Priorité de construction

`distanceToPlayer + depth * 40`, comme la génération, avec une nuance : la construction sert d'abord **sous les pieds**. Une salle qui contient un joueur a une priorité absolue, avant tout calcul de distance (distance nulle, mais surtout garantie même si un calcul est faux).

---

## 14. Persistance

### 14.1 Le problème

Tout conserver : salles, géométrie, positions, seeds, ouvertures, connexions, états de construction, modifications. Avec une base clé/valeur qui n'accepte que des chaînes et dont la limite de taille n'est pas documentée (§3.2).

### 14.2 Mode A — donjon partagé (DBValues serveur)

Clé racine : `dg:L:<lobbyName>:…` via `getLobbyDbValue` / `setLobbyDbValue`.

| Avantages | Contraintes | Conséquences |
| --- | --- | --- |
| Une seule source de vérité : tous les joueurs voient le même donjon. | Tous les joueurs écrivent la même clé. Pas de transactions : dernier écrivain gagnant. | Écrivain unique obligatoire : seul le contrôleur écrit, un cycle à la fois, fragments ciblés. Aucune écriture par bloc. |
| Coût de stockage constant, indépendant du nombre de joueurs. | La portée « per lobby » n'est pas précisée par la doc : on ne sait pas si deux instances du même lobby partagent les données. | **À vérifier par un test en jeu** (§19, Q1). Palliatif : ancrer `dungeonId` et `seed` dans la DB du propriétaire (`api.ownerDbId`), qui est persistante et stable. |
| Un donjon commun rend les boucles et raccourcis utiles à tout le monde. | Les modifications d'un joueur sont vues par tous. | C'est un choix de jeu, pas une contrainte technique : à décider (§20, Q2). |
| Adapté au lobby actuel, qui est déjà multi-joueurs. | Si le lobby est recréé, la pérennité dépend d'une sémantique non documentée. | Prévoir l'export/import manuel de l'état (une chaîne à coller) comme filet de sécurité. |

### 14.3 Mode B — donjon individuel (DBValues joueur)

Clé racine : `dg:P:<playerDbId>:…` via `getPlayerDbValue` / `setPlayerDbValue`.

Le point crucial, et il est documenté : la clé doit être **`api.getPlayerDbId(playerId)`**, pas `playerId`. La doc dit de `PlayerDbId` qu'il s'agit d'un « *permanent identifier that doesn't change when leaving and re-entering* », alors que les identifiants de session changent. Persister sur `playerId` perdrait toutes les données à la reconnexion.

| Avantages | Contraintes | Conséquences |
| --- | --- | --- |
| Isolation stricte : aucune interférence entre joueurs. | N copies de la même géométrie pour N joueurs. | La géométrie n'est **pas** stockée en blocs : seulement la forme (chaîne de bits) et la seed. Une salle coûte ~200 caractères, pas 400. |
| Aucune contention d'écriture : chaque joueur a ses clés. | Chargement au join, synchrone, avant que le joueur puisse bouger. | Index petit et chargement des fragments à la demande : on ne lit que la salle courante et ses voisines. |
| La doc confirme la persistance entre sessions **et** entre lobbies, partagée entre variations. | Les données suivent le joueur partout, y compris dans une variation « hub ». | Bon pour un donjon personnel ; à éviter si le donjon doit être lié à une carte. |
| Indépendant de la durée de vie du lobby. | — | C'est le mode le plus sûr face à l'incertitude du §14.2. |

### 14.4 Recommandation : hybride

Le cahier des charges demande de présenter les deux modes, pas d'en choisir un arbitrairement. La recommandation est un **hybride**, et elle découle directement des contraintes :

- **graphe + géométrie procédurale** dans le stockage partagé (Mode A) : c'est la partie déterministe, identique pour tous, et la seule qui doive être écrite une fois ;
- ~~modifications physiques dans le stockage du joueur (Mode B)~~ : **supprimé**, les murs sont indestructibles (§15) ;
- **états de construction** dans le stockage partagé, puisque le monde est partagé.

Un donjon « cassable » par plusieurs joueurs a besoin de cette séparation : sans elle, soit les modifications d'un joueur écrasent celles d'un autre, soit chaque joueur paie la géométrie complète.

Ce choix ne peut pas être fait par l'agent seul : il change le jeu (§20, Q2).

### 14.5 Fragmentation et budget

```
dg:<dungeonId>:idx            → { v, seed, origin, counters, roomShardMap, metadata }
dg:<dungeonId>:r:<shard>      → { v, seq, rooms: [...colonnes...] }      roomsPerShard = 32
dg:<dungeonId>:r:<shard>:a|b  → double tampon : la version précédente, pour reprise
dg:<dungeonId>:c:<shard>      → connexions
dg:<dungeonId>:op:<opId>      → journal d'opération multi-fragments (§14.6)
dg:<dungeonId>:b:<shard>      → états de construction (petits, mis à jour souvent)
```

- **Chargement à la demande** : un joueur qui entre dans la salle 7 lit `idx`, puis le fragment `r` qui la contient, puis les fragments des salles voisines à moins de 3 arêtes. Rien d'autre.
- **Mises à jour ciblées** : un ensemble `dirtyShards` est vidé en fin de cycle ; on n'écrit que les fragments touchés. Créer une salle touche `idx`, un fragment `r`, un fragment `c`, un fragment `b`.
- **Budget de caractères** : `dbCharBudget` (défaut prudent 200 000 par donjon, paramétrable). Chaque écriture mesure `len(serialized)` **avant** d'envoyer, et le compteur est tenu à jour en mémoire. Au-delà du seuil, la politique de rétention s'applique.
- **Rétention — l'échappatoire qui rend l'infini possible** : une salle `built`, **sans aucune modification**, et située au-delà de `retentionDistance` (défaut 400 blocs) peut voir sa `geometry` **retirée** du stockage. Elle reste dans le graphe (id, position, seed, ouvertures, connexions), et sa forme est **recalculée à l'identique depuis sa seed** quand on en a besoin. Démonstration de correction : la géométrie étant une fonction pure de `(dungeonSeed, parentRoomId, openingId, attempt)`, et l'`attempt` gagnant étant stocké dans `RoomData`, la reconstruction est exacte. C'est le seul moyen honnête de faire tenir un donjon infini dans une base finie. Une salle modifiée ou non construite n'est jamais réduite.
- **Migration de version** : `version` en tête de chaque fragment. Un lecteur qui voit une version plus ancienne applique `migrate(data, from, to)` avant usage ; une version plus récente que le code est refusée proprement (on n'écrase pas des données qu'on ne comprend pas).

### 14.6 Fiabilité des écritures

Rien n'indique que `setLobbyDbValue` puisse échouer visiblement, ni qu'elle soit atomique sur plusieurs clés. On traite donc chaque écriture comme non fiable :

- **Ordre** : on écrit d'abord le fragment de données, ensuite `idx`. Une coupure laisse un fragment orphelin, jamais une référence pendante.
- **Journal d'opération** : pour les changements qui touchent plusieurs fragments, `op:<opId>` est écrit avec l'intention (`{opId, shards, seq}`), puis les fragments, puis la clé est supprimée. Au chargement, un `op` survivant déclenche une vérification : si tous les fragments sont à la bonne `seq`, l'opération est terminée et la clé effacée ; sinon elle est rejouée.
- **Vérification d'intégrité** : chaque fragment porte `seq` (monotone) et `crc` (somme sur la chaîne encodée). À la lecture, `crc` faux ou `seq` régressive ⇒ bascule sur le double tampon `:a`/`:b`. Si les deux sont mauvais, la salle est marquée `failed` et reconstruite depuis sa seed.
- **Détection du déjà-fait** : `seq` et `opId` rendent chaque écriture idempotente. Rejouer une opération qui a réussi est sans effet.
- **Points de sauvegarde** : `doPeriodicSave`, `onClose`, et après `dirtyThreshold` changements (défaut 64). Jamais par bloc.

---

## 15. Suivi des modifications physiques — **supprimé**

**Décision : il n'y a aucun suivi de modifications.** Les murs du donjon sont incassables, et les minerais — les seuls blocs que le joueur pourra casser — ne sont pas structurels. Casser un minerai ne change donc jamais la forme d'une salle, et il n'y a rien à réappliquer au rechargement.

### 15.1 Ce que la proposition initiale prévoyait, et pourquoi elle tombe

La proposition décrivait un `DungeonModificationTracker` complet : deltas en coordonnées locales, capture par `onPlayerChangeBlock` / `onWorldChangeBlock`, barrière d'écriture dans le constructeur, application idempotente après la géométrie, audit d'intégrité, reconstituation de deltas « externes ». C'était cohérent pour un donjon cassable. Ce n'est plus le cahier des charges.

Supprimer ce module retire quatre sources de bugs d'un coup :

- la capture des écritures **du constructeur lui-même** (le piège classique du `builderWriting`) ;
- la distinction « delta absent » / « delta à Air », qui fait réapparaître les murs cassés quand on la confond ;
- l'ordre entre application des deltas et construction de la géométrie ;
- tout le budget de stockage des deltas, qui était le plus gros poste de persistance.

### 15.2 Ce qui reste à garantir

| Garantie | Moyen | Phase |
| --- | --- | --- |
| Le joueur ne peut pas casser un mur | `setCantChangeBlockType` / `setCantChangeBlockRect` sur la coque, `onPlayerChangeBlock` en filet qui renvoie `"preventChange"` | 4 |
| Les minerais sont cassables mais non structurels | ils sont posés dans les cellules de sol, jamais dans un mur, et leur disparition ne change aucune cellule de passage | 4 |
| Une salle reconstruite est identique à l'originale | elle est régénérée depuis sa seed, et la construction est reprise par curseur (§13.3) | 4-6 |

La protection par type de bloc est préférée à une protection bloc par bloc : la documentation signale explicitement que `setCantChangeBlock` sur des milliers de blocs provoque des ralentissements, et fournit `setCantChangeBlockType` / `setCantChangeBlockRect` pour ce cas.

### 15.3 Conséquence sur la persistance

Le format persisté ne contient **que** le donjon lui-même : seed, origine, paramètres de difficulté, salles, ouvertures, connexions, curseurs de construction. Une salle reconstruite depuis sa seed est identique au bloc près, ce qui rend la persistance vérifiable : si la reconstruction diverge, c'est un bug de génération, pas une modification de joueur oubliée.

---

## 16. Garanties de performance

| Garantie | Moyen |
| --- | --- |
| Aucune opération proportionnelle à tout le donjon | Voisinage uniquement par index (salles) et par `Map` (ouvertures). Profondeurs par BFS incrémental local. Chargement par fragments. |
| Pas de collision de rectangles englobants | Cellules réelles sur formes dilatées mises en cache. |
| Données temporaires séparées du permanent | `SpatialIndex`, caches de dilatation, fichiers, compteurs de cycle : tous reconstruits en mémoire. Rien de temporaire n'est persisté. |
| Coût par tick borné | `opsThisTick` contre `maxOpsPerTick`; budget de blocs ; budget de salles ; sortie nette au plafond. |
| Pas de pic sur un joueur isolé | Priorité et budget partagés entre joueurs ; les salles d'un joueur lointain sont suspendues. |
| Pas de fuite mémoire | Les files ne grossissent pas au-delà de `budget × profondeur` ; les caches sont bornés par `cacheMaxRooms`, avec éviction LRU des caches de dilatation. |
| Pas de boucle infinie | `maxAttempts` par génération, `maxOpenAttempts` par ouverture, `cycleRunning`, `try/catch` par file. |
| Mesurable | Un compteur par phase, exposé dans une commande de diagnostic, et un harnais de simulation qui échoue si le coût croît avec le nombre de salles. |

---

## 17. Plan de tests

### 17.1 Tests unitaires

Les tests du moteur existent : **93 tests**, dans `tests/engine/`, exécutés par `npm test` (119 au total avec les 26 tests existants). Le tableau ci-dessous décrit ce qui est réellement vérifié, et non ce qui est prévu.

| Fichier | Ce qui est vérifié | État |
| --- | --- | --- |
| `tests/engine/geometry.test.js` | Conversions `logique ↔ local ↔ monde` aller-retour ; masques, rotations, miroirs ; connectité ; scellement des trous ; dégagements (centre, bord, trou, L) ; contour ; chevauchement sur cellules réelles, y compris la marge, dans les deux sens ; parcours marchable ; les 7 familles de formes ; déterminisme et indépendance vis-à-vis de l'ordre d'appel ; 400 formes sans morceau détaché ni trou ; ouvertures sur le contour, hors angles, avec espacement ; reproductibilité des ouvertures ; nombre d'ouvertures variable ; `canConnectDirectly`, `placeRoomForOpening`, `jointCells`, `bridgeCells`, `passageCells`. | ✅ |
| `tests/engine/index.test.js` | Index contre référence O(n²) sur trois seeds ; toutes les salles réellement en chevauchement sont renvoyées ; suppression d'une salle et de ses ouvertures ; coût par salle non croissant avec la taille du donjon ; une ouverture bloquée n'est jamais proposée ; `wallGap` respecté par **toutes** les connexions commitées. | ✅ |
| `tests/engine/graph.test.js` | Réseau réel : plus d'arêtes que d'un arbre, carrefours, culs-de-sac, tout est atteignable ; aucune cellule partagée ; chaque ouverture appartient à exactement une connexion ou reste libre ; un refus ne laisse **aucune** trace ; même seed ⇒ même donjon (structure complète comparée) ; ordre d'exploration sans effet ; profondeurs cohérentes ; les ouvertures libres ne disparaissent pas ; huit difficultés ordonnées ; rayon respecté ; **aucun appel à `Math.random`** (interdit pendant le test). | ✅ |
| `tests/engine/passage.test.js` | Parcours du donjon entier depuis l'entrée : **tous** les seuils connectés sont atteignables à pied ; chaque passage direct est franchissable ; refus d'une salle posée sur une autre ; refus d'un seuil ouvrant dans un trou ; refus hors rayon ; refus d'une salle aux ouvertures non reliées ; les cellules du passage sont contiguës, sans trou. | ✅ |
| `tests/engine/discovery.test.js` | Formule de priorité et exemple chiffré ; pénalité de profondeur ; `crossing` prioritaire ; distance au plus proche seuil ; portée et profondeur respectées ; ordre total et reproductible ; un seuil vu par deux joueurs n'est offert qu'une fois ; coût d'un scan qui ne croît pas avec le donjon. | ✅ |
| `tests/engine/controller.test.js` | Anti-doublons des trois files ; budget de génération **compté en tentatives** ; construction bornée par son budget ; aucune ouverture générée deux fois ; builder appelé exactement pour les salles créées ; un cycle réentrant est refusé et ne verrouille pas le contrôleur ; un tick ne déclenche pas de cycle avant l'échéance ; une salle suspendue reste dans le graphe ; travail borné quelle que soit la taille du donjon. | ✅ |
| `tests/dungeon/build.test.js` | Ordre de construction imposé ; préconditions de chunk ; reprise au curseur ; relecture et réparation ; aucun mur plein percé. | ◻ Phase 4 |
| `tests/dungeon/persistence.test.js` | Faux magasin clé/valeur avec **plafond de caractères** et pannes injectées (écriture perdue, partielle, `seq` régressive, `crc` faux) ; reprise sur double tampon ; journal d'opération rejoué une seule fois ; migration `v0 → v1` ; rétention (géométrie retirée puis reconstruite à l'identique). | ◻ Phase 5 |
| `tests/engine/architecture.test.js` | Aucun appel `api.*` dans `src/dungeon/engine/` ; aucun `setTimeout`/`setInterval`/`Date.now`/`performance.now`/`await`/`import()` ; aucun import hors du dossier `engine/`. Les commentaires sont retirés avant analyse, sinon la documentation d'une interdiction la déclencherait. | ✅ |

**Ce que les tests ont réellement attrapé** — la liste vaut plus que le décompte :

- une distance de joint fausse dans l'index faisait manquer toutes les boucles ;
- `placeRoomForOpening` calculait le joint depuis une **cellule centre** au lieu d'un **bord**, ce qui donnait un joint de 0 cellule sur les salles dont le seuil touchait le bord local ;
- `validator.openingsOnContour` testait une cellule au lieu de toute la largeur du seuil ;
- `passageIsWalkable` fusionnait deux salles sans creuser le passage, donc le chemin n'existait jamais ;
- une connexion `direct` n'avait pas de champ `bridge`, ce qui faisait planter tout lecteur qui l'itérait.

### 17.2 La règle de sortie des Phases 1 et 2

Avant toute construction physique, un test d'intégration génère **plusieurs centaines de salles en mémoire** et prouve :

1. **aucune collision** : aucune paire de salles n'a de cellule en commun, y compris après dilatation, hors cellules de passage ;
2. **connexions valides** : chaque connexion référence deux ouvertures existantes, de salles distinctes, alignées, et le passage est réellement franchissable (BFS sur le graphe de cellules local) ;
3. **ids uniques** : aucune collision d'id de salle, d'ouverture, de connexion ;
4. **ouvertures cohérentes** : chaque ouverture `connected` a une connexion qui la cite, chaque connexion `connected` a deux ouvertures ouvertes, aucun `reserved` ne survit à un cycle ;
5. **seeds reproductibles** : deux exécutions avec la même seed produisent des graphes identiques (comparaison structurelle) et une exécution avec une seed différente produit un graphe différent.

Le test tourne pour les huit difficultés du lobby, sur des centaines de salles chacune, et affiche les mesures. Il échoue si l'une des cinq propriétés est violée.

### 17.3 Outil de visualisation logique

**✅ Implémenté : `tools/visualize-dungeon.mjs`** (aussi disponible via `npm run visualize`).

```bash
node tools/visualize-dungeon.mjs --seed 12345 --rooms 150
node tools/visualize-dungeon.mjs --seed 12345 --svg /tmp/d.svg --ascii /tmp/d.txt
node tools/visualize-dungeon.mjs --seed 12345 --json      # pour un test ou un diff
```

Il rend une carte ASCII (une cellule par caractère : `#` mur, `.` sol, `o` seuil connecté, `p` seuil libre, `=` joint, `+` pont, `E` salle d'entrée), la même carte en SVG, et un rapport : nombre de salles, de connexions, de ponts, de boucles, de culs-de-sac, profondeur maximale, **ouvertures encore libres**, et **la raison de chaque refus**, avec une phrase d'explication par code. Aucun échec silencieux : c'est un test de la sortie de l'outil, pas de la sortie du jeu.

Exemple de rapport (seed 12345, 150 salles) :

```
seed 12345: 150 rooms, 155 connections (4 joints... ), 6 loops, 56 dead ends, max depth 8, 269 openings left
refusals:
  COLLISION_CELL          148   the candidate overlapped a real cell of an existing room
  DOOR_MISMATCH            20   the child had no doorway of the right width on the facing wall
```

La carte produite est placée dans `docs/examples/` pour être lisible sans exécuter le projet.

### 17.4 Harnais de simulation

**✅ Implémenté : `tools/simulate-players.mjs`** (`npm run simulate`). Il fait tourner le contrôleur comme le jeu le ferait — mêmes ticks, mêmes budgets, `--players` joueurs qui avancent de salle en salle — et publie les compteurs : cycles, salles, blocs, pire cycle, temps par cycle, et le détail découverte / génération / construction. `--static` fige les joueurs pour mesurer le coût quand il n'y a plus rien à découvrir.

C'est ce harnais qui a montré que 80 à 90 % du temps d'un cycle part en génération et que le pic des premiers cycles disparaît une fois le donjon rempli — deux chiffres qu'aucune inspection du code n'aurait donnés.

## 18. Découpage en phases

Chaque phase est testée avant la suivante. Aucune phase ne commence sans que la précédente ait ses tests verts et son critère de sortie atteint.

| Phase | Contenu | Critère de sortie |
| --- | --- | --- |
| **1. Géométrie — ✅ livrée** | `geometry.js`, `shapes.js`, `openings.js`, `random.js`, `config.js`. | Toutes les familles de formes valides ; 400 formes sans forme déconnectée ni trou ; visualiseur ASCII/SVG opérationnel ; tests moteur verts (**59** sur les quatre fichiers du moteur). |
| **2. Graphe — ✅ livrée** | `validator.js`, `spatialIndex.js`, `dungeonManager.js` : connexions, boucles, réutilisation, ponts. | **La règle §17.2 : plusieurs centaines de salles, cinq propriétés prouvées, huit difficultés.** Aucun bloc écrit. **Mesuré : 150 salles, 5 à 8 boucles, profondeur 8-9, 250 ouvertures libres, 4 seeds.** |
| **3. Anticipation — ✅ livrée** | `discovery.js`, `queues.js`, `controller.js` : `PlayerTracker`, trois files, priorités, budgets, suspension. | Priorités conformes à l'exemple ; budget par cycle respecté **et vérifié en comptant les tentatives** ; files sans doublon ; reprise refusée ; scénarios 1 à 4 du harnais verts. |
| **4. Construction** | `DungeonBuilder`, `DungeonBuildQueue`, préconditions de chunk, ordre imposé, reprise, vérification. | Salles réellement construites dans Bloxd, sans trou, sans mur plein percé ; scénarios 5 et 6 verts ; reprise au curseur prouvée. |
| **5. Persistance** | `DungeonPersistence`, fragmentation, budget, migration, rétention. | Rechargement identique ; pannes injectées absorbées ; gain de compactage ≥ 3× mesuré ; scénarios 7 et 8 verts. |
| **6. Fiabilité et optimisation** | `DungeonRecovery`, audit, réparation, profilage. | Audit d'intégrité sur 200 salles ; géométrie reconstruite à l'identique depuis la seed après redémarrage ; aucune régression de coût à 2 000 salles. |

Le code du lobby et du spawn (`src/worldCode.js`, la partie spawn de `generator.js`) n'est pas touché avant la Phase 4, où il est rebranché sur le nouveau moteur. Les 26 tests existants restent verts à chaque phase ; ils sont désormais rejoints par les tests du moteur (`npm test`, **119** tests).

---

## 19. Risques et points non résolus

| # | Risque | Impact | Mitigation prévue | Statut |
| --- | --- | --- | --- | --- |
| 1 | La limite de longueur des DBValues n'est pas documentée. | Un dépassement pourrait être ignoré silencieusement. | Budget de caractères mesuré avant écriture, fragmentation, rétention par régénération. | **À clarifier** (§20, Q1) |
| 2 | La portée exacte de `setLobbyDbValue` (« per lobby ») n'est pas précisée : deux instances du même lobby partagent-elles les données ? | Perte du donjon partagé si les lobbies sont éphémères. | Ancrage de `dungeonId` + `seed` dans la DB du propriétaire ; export/import manuel. | **À tester en jeu** |
| 3 | Aucune API S3 documentée malgré la mention dans `doPeriodicSave`. | Aucun stockage externe possible. | Ne pas en dépendre ; la régénération depuis la seed couvre le volume. | Limite acceptée |
| 4 | Les écritures de bloc dans un chunk non chargé sont perdues. | Trous dans le sol. | Préconditions du constructeur, `isBlockInLoadedChunk`, réchauffement, vérification après écriture. | Déjà corrigé sur le code existant |
| 5 | `getBlockSolidity` ne distingue pas « non chargé » de « plein ». | Une validation basée sur le monde serait fausse. | La validation ne lit jamais le monde. | Résolu par conception |
| 6 | Un mouvement de caméra ou de joueur peut sortir des chunks chargés. | Salle construite derrière le joueur, jamais vue. | Construction prioritaire sous les pieds et devant, et vérification d'intégrité. | Surveillé |
| 7 | ~~Une modification non passée par un callback serait perdue.~~ | — | Sans suivi de modifications (§15), le risque n'existe plus : un mur ne peut pas être cassé. | **Supprimé** |
| 8 | Coût d'un tick trop élevé fige le monde pour tous les joueurs. | Jeu injouable pendant un pic. | Plafond d'opérations, budgets séparés, mesure dans le harnais. | Surveillé |
| 9 | Une boucle de connexions mal détectée pourrait produire un mur partagé par deux salles. | Incohérence géométrique. | Collisions en cellules réelles + test d'index contre référence O(n²). | Couvert par test |
| 10 | La portée des `setCantChangeBlockRect` par joueur doit être réappliquée à chaque connexion. | Protection perdue après reconnexion. | Réapplication dans `onPlayerJoin`. | À implémenter |

---

## 20. Décisions demandées avant la Phase 1

Ces points changent l'architecture ; ils ne relèvent pas d'un choix technique évident. Les phases 1 et 2 peuvent démarrer sans les réponses 2, 5 et 6 ; les phases 4 et 5 en dépendent.

1. **Limite de stockage.** Connais-tu la limite réelle des DBValues (caractères par valeur, par joueur, par lobby) ? Elle n'est pas dans la documentation, et la seule mention est indirecte (`setCurrency` : « *count towards db length limits* »). Sans réponse, je pars sur les valeurs prudentes ci-dessus, toutes paramétrables, et je mesure en jeu dès la Phase 5 avec un test de dépassement volontaire.
2. **Mode de persistance.** Donjon partagé (A), individuel (B), ou l'hybride recommandé en §14.4 : graphe partagé, modifications par joueur ? Ce choix définit le jeu, pas seulement le stockage.
3. **Un seul niveau ou plusieurs ?** Le cahier des charges mentionne une hauteur min/max. Le moteur est conçu pour plusieurs niveaux (`floorLevel`), mais les escaliers et les connexions verticales sont un travail distinct que je propose de traiter après la Phase 4.
4. **Placement du donjon dans le monde.** Le donjon reçoit une origine allouée (anneau de 4096 blocs), le lobby reste où il est. Cela implique une téléportation, donc le cycle « téléporter → attendre les chunks → construire » déjà en place. Confirmes-tu ce placement, ou le donjon doit-il entourer le lobby ?
5. **Le donjon doit-il être cassable ?** « Dungeon Break » suggère que oui. Si oui, la coque n'est pas protégée et chaque modification coûte des deltas. Si seul un type de bloc est cassable, le volume de deltas diminue beaucoup et la protection par `setCantChangeBlockType` suffit.
6. **Rétention.** Acceptes-tu que les salles lointaines, entièrement construites, voient leur géométrie retirée du stockage et soient régénérées à l'identique depuis leur seed ? C'est la condition pour qu'un donjon infini tienne dans une base finie. Depuis que les murs sont indestructibles (§15), aucune salle ne peut plus diverger de sa seed : la rétention est donc sans risque de perte.

---

## Annexe A — Ce qui reste du code existant

Réutilisé tel quel :

- `src/utils/scheduler.js` — horloge unique, déjà testée ;
- la séquence de spawn : `getBlock` → téléportation en `x.5`/`z.5` → `chunkWarmupTicks` → plaque/box → construction ;
- `repairFloorTiles`, `readBlockName`, la vérification après écriture et la réparation ;
- le lobby, les pads de difficulté, le compte à rebours par joueur.

Remplacé :

- `createEndlessRoomPlan`, `chooseStreamedModule`, `pickStreamedExit`, `buildNextStreamRoom`, `continueStreaming` — la marche de modules et les couloirs implicites disparaissent au profit de la génération par ouvertures ;
- `roomBoxesClash` — remplacé par la validation en cellules réelles.

Conservé mais non utilisé par le nouveau moteur, en attendant la Phase 4 : le générateur par grille (`createDungeonPlan`) pour la parité visuelle pendant la transition.

## Annexe B — Paramètres par défaut (tous dans une seule configuration)

`src/dungeon/engine/config.js`, un seul objet `DUNGEON_CONFIG` exporté, aucune constante numérique dispersée dans les algorithmes. Les paramètres qui décrivent les salles sont **ceux du code livré** ; ceux des phases suivantes (anticipation, construction, persistance) restent des valeurs cibles, marquées comme telles.

| Groupe | Paramètre | Défaut |
| --- | --- | --- |
| Dimensions | `minWidth`, `maxWidth` | 4, 11 |
| | `minDepth`, `maxDepth` | 4, 11 |
| | `wallHeight` | 4 |
| | `cellSize` | 1 |
| Passages | `minPassageWidth`, `maxPassageWidth` | 1, 1 (uniforme, §8.4) |
| | `passageHeight` | 3 (plafond de 4, linteau de 1) |
| | `wallGap` (**la** constante du joint) | **3** |
| | `minCornerClearance` | 1 |
| | `minOpeningSpacing` | 2 |
| | `minOpenings`, `maxOpenings` | 2, 5 |
| | `cellsPerOpening` (densité) | 6 cellules de périmètre par ouverture |
| | `structureMargin` | 0 (une marge non nulle refuse des salles sans créer de boucle, §10.4) |
| | `maxBridgeLength` | 4 |
| | `braidChance` | 0,5 |
| Génération | `maxGenerationAttempts` (par tentative de salle) | 6 |
| | `maxOpenAttempts` (avant `blocked`) | 3 |
| | `maxDungeonRadius` (rayon du donjon) | 512 cellules |
| | `regionSize` (index spatial) | 16 |
| | `originStride` | 4096 ◻ Phase 5 |
| Anticipation ◻ | `triggerDistance` | 30 |
| | `crossingDistance` | 6 |
| | `anticipationDepth` | 3 |
| | `priorityDepthWeight` | 40 |
| | `maxRoomsPerCycle` | 10 |
| | `maxDiscoveryPerCycle` | 40 |
| | `maxBlocksPerCycle` | 800 |
| | `maxOpsPerTick` | 4000 |
| | `cycleTicks` | 20 |
| | `playerScanIntervalTicks` | 10 (lire les positions 2×/s, pas 20×/s) |
| | `backlogThreshold` | 60 salles |
| | `maxAnticipationDistance` | 96 blocs |
| Construction ◻ | `blocksPerBatch` | 80 |
| | `chunkWarmupTicks` | 3 (existant, inchangé) |
| | `verifySampleRate` | 8 |
| Persistance ◻ | `roomsPerShard` | 32 |
| | `dbCharBudget` | 200 000 par donjon (prudent, paramétrable) |
| | `dirtyShardThreshold` | 64 changements |
| | `retentionDistance` | 400 blocs |
| | `schemaVersion` | 1 |

Les valeurs marquées « existant » viennent du code actuel et ne changent pas : elles corrigent des bugs observés en jeu.

---

## Annexe C — Sources non officielles utilisées, et leur statut

Deux informations utiles **ne viennent pas de la documentation officielle** et sont donc signalées comme telles, jamais utilisées comme fondement d'une décision :

- la limite de **512 000 caractères** de code est officielle (changelog du 18 août 2026) ; en revanche la limite de **32 000 caractères par code block** vient d'un guide tiers ;
- l'arrêt d'un code au bout de **~10 s** dans un tick, et le fait que `api.isNearInterrupt` ne se déclenche pas, viennent d'un guide tiers (probes). L'architecture n'en dépend pas : les budgets sont exprimés en opérations, pas en temps.

Le projet ne dépend d'aucune de ces valeurs : elles servent seulement à calibrer des paramètres par défaut.
