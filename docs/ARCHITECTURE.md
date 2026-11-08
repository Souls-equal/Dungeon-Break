# Architecture — moteur de donjon procédural infini

**Statut : proposition. Aucune ligne du moteur n'est implémentée.** Ce document est le livrable d'architecture demandé avant tout développement : il décrit le découpage, les structures de données, les algorithmes, les stratégies de persistance et de suivi des modifications, les limites identifiées et le plan de tests. Il attend la validation du propriétaire du projet avant que la Phase 1 ne commence.

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
15. [Suivi des modifications physiques](#15-suivi-des-modifications-physiques)
16. [Garanties de performance](#16-garanties-de-performance)
17. [Plan de tests](#17-plan-de-tests)
18. [Découpage en phases](#18-découpage-en-phases)
19. [Risques et points non résolus](#19-risques-et-points-non-résolus)
20. [Décisions demandées avant la Phase 1](#20-décisions-demandées-avant-la-phase-1)

Annexes : [A — Ce qui reste du code existant](#annexe-a--ce-qui-reste-du-code-existant) · [B — Paramètres par défaut](#annexe-b--paramètres-par-défaut-tous-dans-une-seule-configuration) · [C — Sources non officielles](#annexe-c--sources-non-officielles-utilisées-et-leur-statut)

---

## 1. Périmètre et principes directeurs

Le moteur remplace la génération actuelle (`src/dungeon/generator.js`, marche de modules 7×7 raccordés par une case de couloir). Le lobby, le compte à rebours et le spawn restent inchangés ; ils seront rebranchés en Phase 4.

Six principes, qui se traduisent chacun par une règle vérifiable dans le code :

| Principe | Règle concrète |
| --- | --- |
| Séparer le logique du physique | Les modules `Generator`, `Geometry`, `Validator`, `SpatialIndex` ne connaissent **ni `api.getBlock` ni `api.setBlock`**. Seuls `Builder` et `ModificationTracker` touchent le monde, plus `Persistence` qui touche la base de données. Un test d'architecture vérifie l'absence de `api.` dans ces fichiers. |
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

Treize modules comme demandé, regroupés en quatre couches. Aucun module d'une couche basse n'importe une couche haute.

```
┌──────────────────────────────────────────────────────────────────────┐
│ COUCHE BLoxd (seule à connaître api.*)                               │
│                                                                      │
│  DungeonController ──── horloge unique, orchestration des cycles     │
│      │                                                               │
│      ├── PlayerTracker ──────── position, salle courante, priorités  │
│      ├── DungeonBuilder ─────── écriture des blocs, vérification     │
│      ├── DungeonBuildQueue ──── budget de blocs, reprise             │
│      ├── DungeonPersistence ── DBValues, fragments, migration        │
│      └── DungeonModificationTracker ─ deltas, callbacks de blocs     │
└──────────────────────────────────────────────────────────────────────┘
                    │  (interfaces en données simples)
┌───────────────────▼──────────────────────────────────────────────────┐
│ COUCHE LOGIQUE (aucun api.*)                                         │
│                                                                      │
│  DungeonManager ─── graphe : salles, ouvertures, connexions          │
│      │                                                               │
│      ├── DungeonGenerator ─── croissance par ouvertures, seeds        │
│      ├── DungeonConnector ─── appariement d'ouvertures, réutilisation│
│      ├── DungeonValidator ─── collisions réelles, passages, murs      │
│      └── DungeonSpatialIndex ─ grille de hachage, index d'ouvertures  │
│                                                                      │
│  DungeonGeometry ── cellules, formes, contours, conversions           │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────▼───────────────────────────────────────────────┐
│ COUCHE SUPPORT                                                       │
│  DungeonRecovery ── reprise après interruption, réparation, audit    │
└──────────────────────────────────────────────────────────────────────┘
```

| Module | Responsabilité unique | Ne fait jamais |
| --- | --- | --- |
| `DungeonGeometry` | Formes en cellules, contours, dilatation, conversions logique/local/monde | Écrire, lire le monde |
| `DungeonGenerator` | Croissance : produit une salle candidate depuis une ouverture parente | Valider, enregistrer |
| `DungeonConnector` | Choisit l'ouverture d'accueil, apparie deux ouvertures, réutilise une salle existante | Générer une forme |
| `DungeonValidator` | Fonction pure : accepte ou refuse une candidate, avec un code de refus | Modifier quoi que ce soit |
| `DungeonSpatialIndex` | Requêtes de voisinage en temps constant | Décider |
| `DungeonManager` | Source de vérité du graphe, unique point de commit, BFS, profondeurs | Toucher au monde |
| `PlayerTracker` | Position → salle → distance, profondeur, classe de priorité | Décider du budget |
| `DungeonController` | Boucle par tick, répartition des budgets, anti-cycles concurrents | Générer ni construire lui-même |
| `DungeonBuilder` | D'un `RoomData` validé vers des blocs, dans l'ordre imposé | Décider *quoi* construire |
| `DungeonBuildQueue` | File de construction, curseur de reprise, coût en blocs | Écrire des blocs |
| `DungeonPersistence` | Sérialisation compacte, fragments, budget de caractères, migrations | Décider du contenu |
| `DungeonModificationTracker` | Deltas en coordonnées locales, capture, application, idempotence | Construire la géométrie |
| `DungeonRecovery` | Rechargement, réparation, audit d'intégrité, reprise des constructions interrompues | Remplacer les autres modules |

`DungeonBuildQueue` est séparé de `DungeonBuilder` parce que la reprise après interruption est un problème de **curseur persistant**, pas d'écriture : les deux ont des raisons de changer distinctes.

---

## 5. Système de coordonnées

Trois repères, et une règle : **un seul module fait les conversions**.

| Repère | Unité | Origine | Qui l'utilise |
| --- | --- | --- | --- |
| `F_logical` | cellule entière | origine du donjon | Generator, Validator, Connector, SpatialIndex, Manager, files |
| `F_local` | bloc, relatif à une salle | coin min de la salle, au niveau du sol | deltas de modification, reconstruction |
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
| Un delta de modification | 89 |
| 1 200 `RoomData` | ≈ 857 000 |

Une salle à 714 caractères ne tient pas dans un budget réaliste. Le format de **stockage** n'est donc pas le format en mémoire : `Persistence` encode une salle en **colonnes indexées** (tableaux parallèles, ouvertures en indices, forme en chaîne de bits, coordonnées relatives à l'origine en décimal court). Cible : **150 à 250 caractères par salle**, soit ~4 000 à 6 000 salles dans 1 M de caractères. La Phase 5 mesure le gain réel sur 1 000 salles et refuse la livraison si le facteur est inférieur à 3.

---

## 7. Formes procédurales et géométrie

### 7.1 Contrat

Une forme est un **ensemble de cellules** sur une grille `w × h`, avec `w, h ∈ [minDim, maxDim]`. Elle est indépendante des blocs : aucune forme ne dit « met un bloc de pierre ici ». C'est ce qui permet de tester la géométrie, de la visualiser en ASCII et de la sérialiser en quelques dizaines de caractères.

### 7.2 Grammaire de formes

Cinq familles, tirées par la seed de la salle, toutes paramétriques :

| Famille | Construction |
| --- | --- |
| `rect` | rectangle `w × h` |
| `notch` | rectangle moins un coin (asymétrique) |
| `cross` | rectangle plus deux extensions opposées |
| `alcove` | rectangle plus une ou plusieurs extensions latérales d'une cellule |
| `irregular` | rectangle, puis croissance/creusement par marche aléatoire bornée sur les bords |

Chaque forme passe par `normalizeShape`, qui applique des invariants et **rejette** la forme (et redemande un tirage) si l'un échoue :

1. **Connexité** : un remplissage depuis la première cellule doit atteindre toutes les cellules. Pas de morceau déconnecté.
2. **Largeur de passage** : il existe un chemin entre toute paire d'ouvertures dont toutes les cellules ont un dégagement de `minPassageWidth` (test par BFS sur les cellules dont le voisinage carré est dans la forme). Une salle ne peut pas être un cul-de-sac mural.
3. **Marge d'angles** : aucune ouverture ne touche un coin ; la face qui la porte doit avoir au moins `minOpeningSpacing` cellules libres de chaque côté.
4. **Contour** : calculé une fois et mis en cache (`contourSegments`), pas recalculé par le constructeur.

### 7.3 Représentation

`geometry.rows` est une liste de chaînes binaires. Coût : `w × h` caractères, soit 24 pour une salle 6×4, et 64 au maximum pour une 8×8. Les contours, la dilatation et le masque de passages sont **dérivés** et jamais stockés.

`dilate(shape, k)` est calculé une fois par salle et mis en cache pour deux valeurs de `k` : `wallThickness` (occupation physique) et `wallThickness + safetyMargin` (marge de sécurité). C'est ce cache qui rend la validation en collisions réelles aussi rapide qu'un test de rectangles englobants, sans en avoir les faux positifs.

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

Une ouverture n'est créée que si, à la fin de `normalizeShape` :

1. La face est **réellement un mur** : la cellule intérieure adjacente appartient à la forme, la cellule extérieure n'y appartient pas. Jamais d'ouverture sur un trou de la forme.
2. Elle n'est pas dans un angle : `offset ≥ 1` et `offset + width ≤ faceLength - 1`.
3. Elle est à `≥ minOpeningSpacing` de toute autre ouverture de la même face.
4. Son couloir d'approche (`width × passageDepth` cellules vers l'intérieur) est entièrement dans la forme : on peut s'y tenir.
5. Sa hauteur tient sous le plafond : `height + 1 ≤ wallHeight`.

Le nombre d'ouvertures dépend de la taille et de la seed : `1 + floor(perimeter / openingsPerCells)`, borné par config, et au moins une `pending` tant qu'il reste une face libre.

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

Une salle ne naît que d'une ouverture `pending` d'une salle existante.

```
expand(parentRoom, parentOpening):
  pour attempt = 0 .. maxAttempts-1:
    rng      = prng(attemptSeed)
    shape    = normalizeShape(shapeGrammar(rng), config)            // §7
    childOp  = shape.openings[attempt % shape.openings.length]      // déterministe
    origin   = parentOpening.cell + parentOpening.dir - childOp.localCell
    // 1) la salle existante compatible est cherchée AVANT de créer du neuf
    reuse    = connector.findReusableOpening(shape, origin, parentOpening)
    si reuse: commit(connection(parentOpening, reuse)) → fin (aucun budget consommé)
    // 2) sinon, candidate neuve
    verdict  = validator.validate({ shape, origin, openings, parentOpening })
    si verdict.ok: commit(room + connection) → retour
    sinon: enregistrer verdict.code (compteur de diagnostic)
  parentOpening.failures += 1
  si failures ≥ maxOpenAttempts: parentOpening.status = "blocked"
```

Points importants :

- **Aucune connexion par couloir par défaut.** Une connexion `direct` exige que la cellule d'ouverture de l'enfant soit **exactement adjacente** à celle du parent et que les deux ouvertures s'alignent (même axe, même largeur, offsets compatibles). Sinon il faut une connexion `bridge`, explicitement demandée, avec ses cellules stockées.
- **Réutilisation.** `findReusableOpening` interroge l'index d'ouvertures sur la cellule visée. S'il y a déjà une ouverture `pending` d'une autre salle exactement face à la nouvelle, on la connecte : c'est une boucle ou un raccourci, qui ne crée aucune salle et ne consomme aucun budget de génération. C'est le mécanisme demandé de réutilisation de salles existantes.
- **Budget.** Un échec, une réutilisation ou une ouverture déjà connectée ne consomment rien (règle explicite du cahier des charges) ; seule une salle effectivement créée compte.

### 9.3 Boucles et profondeurs

`DungeonManager` tient le graphe. Après chaque commit :

- `connectionCount`, `depth` du nouveau nœud (`parent.depth + 1`, recalculée si le nœud était déjà là) ;
- un **BFS incrémental** maintient les profondeurs sans reparcourir le graphe entier : seule la composante affectée est remise à jour, et une réutilisation qui raccourcit un chemin déclenche un BFS local borné à la zone touchée ;
- `openings` disponibles d'une salle = `pending` ; `neighbors` = salles reliées ; `freeOpenings` = index d'ouvertures `pending` — trois requêtes en O(1)/O(degré).

---

## 10. Validation et atomicité

### 10.1 Codes de refus

Le validateur renvoie un objet, jamais un booléen : le diagnostic sert au visualiseur, aux statistiques et aux tests.

```js
{ ok: false, code: "COLLISION_CELL", at: { x, z }, withRoom: "r12" }
```

| Code | Cause |
| --- | --- |
| `OUT_OF_BOUNDS` | hors du rayon maximal du donjon |
| `OPENING_NOT_ON_WALL` | ouverture sur un trou de la forme |
| `OPENING_IN_CORNER` | marge d'angle insuffisante |
| `OPENING_TOO_CLOSE` | espacement insuffisant sur une face |
| `OPENING_NO_APPROACH` | couloir d'approche hors de la forme |
| `COLLISION_CELL` | une cellule **réelle** de la forme dilatée heurte une autre salle |
| `DOOR_MISMATCH` | largeur, hauteur, alignement ou sens incompatibles |
| `DOOR_NO_CLEARANCE` | marge de sécurité fermant le passage pourtant voulu |
| `NO_WALKABLE_PATH` | le passage ne relie pas réellement les deux intérieurs |
| `ROOM_DISCONNECTED` | les ouvertures de la nouvelle salle ne sont pas reliées entre elles |
| `BELOW_MIN_HEIGHT` | plafond incompatible avec la hauteur de passage |

### 10.2 Ordre des contrôles

Du moins cher au plus cher, avec sortie anticipée. Le coût typique d'une validation acceptée est de quelques dizaines d'opérations, parce que la plupart des refus sortent sur `OUT_OF_BOUNDS` ou `COLLISION_CELL`.

### 10.3 Collisions réelles, pas rectangles englobants

Deux formes en L peuvent avoir des rectangles englobants qui se chevauchent sans qu'aucune cellule ne se touche. Le validateur ne compare donc jamais des boîtes :

1. Requête d'index sur `bounds(candidate) + wallThickness + safetyMargin` → quelques salles candidates seulement.
2. Pour chaque candidate : test cellule par cellule sur `dilate(candidate, wallThickness + margin)` contre `dilate(otherRoom, wallThickness + margin)`, restreint à l'intersection des deux boîtes, avec sortie au premier conflit.
3. Les deux formes étant en chaînes binaires, le test d'intersection est une comparaison de caractères sur les lignes qui se chevauchent.

Un test dédié vérifie les **deux** sens : deux L dont les boîtes se chevauchent mais pas les cellules doivent être acceptées ; deux salles dont les cellules se touchent doivent être refusées.

### 10.4 Marge de sécurité sans bloquer les connexions voulues

C'est un piège classique : une marge appliquée naïvement ferme toutes les portes, puisque deux salles raccordées sont par construction au contact.

La règle est donc explicite : la marge s'applique partout **sauf sur le rectangle de passage**. Concrètement, on dilate les deux formes, on intersecte, puis on **soustrait** le rectangle `passageRect(parentOpening, childOpening)` de l'ensemble des cellules en conflit. Si après soustraction il ne reste rien, la marge est respectée. C'est ce qui permet d'avoir `safetyMargin = 2` sans perdre une seule connexion, et le test `DOOR_NO_CLEARANCE` couvre le cas inverse (une marge qui fermerait un passage non prévu).

### 10.5 Atomicité et tentatives

Une génération est une transaction :

```
tx = manager.begin()
tx.reserve(parentOpening)        // en mémoire uniquement
tx.commit({ room, connection })  // seul point d'écriture :
                                 //   index spatial, graphe, profondeurs,
                                 //   marquage des deux ouvertures,
                                 //   compteurs d'ids
tx.rollback()                    // sur toute exception : aucune trace
```

`commit` est le seul endroit du moteur qui modifie le graphe. `rollback` défait les réservations en mémoire et rien d'autre, puisque rien n'a été écrit sur disque. Un `try/catch` entoure chaque cycle du contrôleur : une exception dans une génération est journalisée et le cycle continue, sans jamais laisser une ouverture `reserved` orpheline (un balayage en fin de cycle libère les réservations orphelines, ceinture et bretelles).

---

## 11. Index spatial

Deux structures, toutes deux en `Map`, toutes deux en O(1) par requête.

**Grille de hachage des salles.** `regionSize = 32` cellules. Une salle est enregistrée dans toutes les régions que couvre sa boîte **dilatée**. `queryRect(rect)` renvoie l'union des salles des régions touchées, dédupliquée. Insertion et suppression coûtent O(régions touchées), soit 1 à 4 pour une salle de 8×8.

**Index des ouvertures.** Clé = `side + ":" + x + ":" + z` de la cellule **juste à l'extérieur** d'une ouverture `pending`. Une requête « y a-t-il une ouverture face à la mienne ? » est une seule lecture de `Map`. C'est ce qui rend la détection de boucles et la réutilisation exactes et gratuites, au lieu d'un balayage de proximité approximatif.

Ce que l'index ne fait pas : décider. Il ne renvoie que des candidats ; c'est le validateur qui tranche, en collisions réelles.

Un test de propriété compare l'index à une implémentation de référence en O(n²) sur 500 salles aléatoires : l'index doit renvoyer un **sur-ensemble** de la réponse exacte, et le validateur doit rendre le même verdict que la référence sur 300 cas. Sans ce test, une erreur d'index se traduirait par des murs qui se croisent en jeu, très loin de sa cause.

---

## 12. Anticipation : les trois opérations et les trois files

### 12.1 Trois opérations distinctes

| Opération | Entrée | Sortie | Coût | Consomme un budget de génération ? |
| --- | --- | --- | --- | --- |
| **Découverte** | position d'un joueur, salle courante | ouvertures `pending` à `≤ 30` blocs → `discoveryQueue` | très faible | non |
| **Génération logique** | une ouverture | salle validée + connexion enregistrées | moyen | oui, 1 par salle créée |
| **Construction** | une salle `not_started` | blocs dans le monde | élevé, mesuré en blocs | budget de blocs distinct |

Séparer les trois est ce qui permet de répondre à « le joueur arrive dans une salle qui n'existe pas » : la découverte et la génération vont plus vite que la construction, donc on peut toujours avoir un graphe en avance et une construction qui rattrape.

### 12.2 Déclencheurs

- **Distance** : `triggerDistance = 30` blocs. Une ouverture `pending` dont la cellule extérieure est à moins de 30 blocs du joueur entre en file de découverte.
- **Profondeur** : `anticipationDepth = 3`. On génère jusqu'à 3 arêtes au-delà de la salle du joueur, sur **toutes** les branches, pas seulement celle qu'il semble suivre.
- **Franchissement imminent** : à moins de `crossingDistance = 6` blocs d'une ouverture, la priorité passe en classe `crossing` et le budget lui est réservé en premier.

### 12.3 Priorité

```
class = crossing ? 0 : 1                       // 0 : à traiter d'abord
priority = distanceToPlayer + depth * 40       // plus petit = plus prioritaire
```

Tri : classe, puis `priority`, puis id (départage stable, donc reproductible). L'exemple du cahier des charges est un test unitaire : A 120, C 250, B 8148, D 5285 ⇒ **A, C, B, D**.

### 12.4 Trois files

| File | Clé d'unicité | Contenu | Budget |
| --- | --- | --- | --- |
| `discoveryQueue` | `roomId.openingId` | ouvertures à évaluer | `maxDiscoveryPerCycle`, défaut 40 |
| `generationQueue` | `roomId.openingId` | ouvertures à développer | `maxRoomsPerCycle = 10` |
| `buildQueue` | `roomId` | salles validées à construire | `maxBlocksPerCycle`, défaut 800 |

Chaque file est un tableau plus un `Map` d'appartenance : l'anti-doublon est une lecture de `Map`, pas un parcours. Les tailles sont bornées (le générateur ne crée pas plus de `budget × profondeur` entrées par cycle), donc un tri par cycle reste négligeable ; un test le vérifie au lieu de le supposer.

Une salle ne peut pas être dans `generationQueue` et déjà `connected`, ni dans `buildQueue` sans être validée : les invariants sont réaffirmés à l'entrée, pas seulement à la sortie.

### 12.5 Contrôle de fréquence et gestion du retard

Tout est piloté par `tick(ms)`, via le scheduler existant, une fois par tick. Le contrôleur :

1. met à jour `PlayerTracker` tous les `trackerIntervalTicks` (défaut 10 ticks, 2×/s) — lire `getPosition` de chaque joueur à chaque tick coûte plus que ça ne rapporte ;
2. exécute un **cycle** tous les `cycleTicks` (défaut 20 ticks, 1 s) : découverte, puis génération jusqu'à épuisement du budget, puis construction jusqu'à épuisement du budget de blocs ;
3. compte les opérations du tick (`opsThisTick`) et s'arrête net au plafond, quel que soit l'état des files.

Gestion du retard, si `fileLength > backlogThreshold` :

- la priorité des éléments proches est **boostée** (`priority *= 0.5`) ;
- les salles au-delà de `maxAnticipationDistance` (défaut 96 blocs) sont **suspendues** : elles sortent des files, restent dans le graphe, et y reviennent quand un joueur s'en approche. Un compteur `suspendedRooms` est exposé dans `metadata` ;
- le budget de génération est plafonné pour laisser respirer la construction : le graphe en avance ne sert à rien s'il n'y a pas de sol sous les pieds.

**Une salle n'est jamais annoncée « prête » avant `buildState === "built"` et le passage de la vérification d'intégrité.** Un test dédié vérifie qu'aucun message « ready » ne peut précéder le dernier bloc.

**Aucune API de temporisation non documentée** : pas de `setTimeout`, pas de `Promise`, pas de `Date.now()` dans une mesure de durée. Un test échoue si ces identifiants apparaissent dans `src/dungeon/`.

### 12.6 Anti-cycles concurrents

Un seul contrôleur par donjon, une seule boucle par tick. Les réentrances sont impossibles par construction, mais deux garde-fous existent quand même : un indicateur `cycleRunning` (si un callback exotique réentrait, le cycle est abandonné au lieu de s'empiler) et un `try/catch` par file, pour qu'une file cassée n'empêche pas les autres d'avancer.

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
| 6 | **application des deltas** de modification | après la géométrie, et le constructeur saute les cellules modifiées (§15.4) |
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
- **modifications physiques** dans le stockage du joueur (Mode B) : ce sont des deltas petits, propres à un joueur, et c'est là que l'isolation compte ;
- **états de construction** dans le stockage partagé, puisque le monde est partagé.

Un donjon « cassable » par plusieurs joueurs a besoin de cette séparation : sans elle, soit les modifications d'un joueur écrasent celles d'un autre, soit chaque joueur paie la géométrie complète.

Ce choix ne peut pas être fait par l'agent seul : il change le jeu (§20, Q2).

### 14.5 Fragmentation et budget

```
dg:<dungeonId>:idx            → { v, seed, origin, counters, roomShardMap, metadata }
dg:<dungeonId>:r:<shard>      → { v, seq, rooms: [...colonnes...] }      roomsPerShard = 32
dg:<dungeonId>:r:<shard>:a|b  → double tampon : la version précédente, pour reprise
dg:<dungeonId>:c:<shard>      → connexions
dg:<dungeonId>:m:<shard>      → deltas de modification d'un groupe de salles
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
- **Vérification d'intégrité** : chaque fragment porte `seq` (monotone) et `crc` (somme sur la chaîne encodée). À la lecture, `crc` faux ou `seq` régressive ⇒ bascule sur le double tampon `:a`/`:b`. Si les deux sont mauvais, la salle est marquée `failed` et reconstruite depuis sa seed, avec ses deltas réappliqués.
- **Détection du déjà-fait** : `seq` et `opId` rendent chaque écriture idempotente. Rejouer une opération qui a réussi est sans effet.
- **Points de sauvegarde** : `doPeriodicSave`, `onClose`, et après `dirtyThreshold` changements (défaut 64). Jamais par bloc.

---

## 15. Suivi des modifications physiques

### 15.1 Le besoin

Le joueur casse le donjon. Une modification doit survivre au rechargement du serveur, à la reconstruction d'une salle et au retour d'un autre joueur. La seed ne suffit pas : elle redonne la géométrie d'origine, pas ce que le joueur en a fait.

### 15.2 Format et distinction vide / absent

```js
Delta = {
  roomId: "r7",
  local: { x: 3, y: 1, z: 5 },     // F_local : survit à un déplacement de la salle
  op: 4107,                        // id d'opération monotone, pour l'idempotence
  originalBlock: "Stone Bricks",   // état procédural, écrit une seule fois par cellule
  currentBlock: "Air",
  type: "break",                   // break | place | replace | external
  tick: 120394
}
```

**Bloc vide contre donnée manquante.** L'absence de delta sur une cellule signifie « aucune modification connue » : la cellule prend son bloc procédural. Un delta avec `originalBlock: "Air"` signifie « le joueur a posé un bloc là où la procédure n'en mettait pas ». Ce sont deux états différents, et les confondre est exactement le bug qui fait réapparaître les murs cassés.

`originalBlock` n'est écrit qu'une fois par cellule : c'est l'état procédural, jamais l'état intermédiaire. Une cellule cassée puis reconstruite garde son `originalBlock` d'origine.

### 15.3 Capture événementielle

L'API permet la capture : c'est documenté et c'est le mécanisme principal.

- `onPlayerChangeBlock(playerId, x, y, z, fromBlock, toBlock, …)` est appelé « *before the block is set* », et fournit à la fois l'ancien et le nouveau bloc. C'est une capture fiable, sans relecture, au bon moment.
- `onWorldChangeBlock(x, y, z, fromBlock, toBlock, initiatorDbId, extraInfo, …)` couvre les changements qui ne viennent pas d'un joueur. `initiatorDbId` vaut `null` pour du code de jeu, et `extraInfo.cause` peut valoir `"Explosion"`, `"MeltingIce"`, `"Sapling"`, etc. C'est ce qui permet de ne pas perdre une explosion.

**Le piège à ne pas manquer.** Le constructeur écrit des milliers de blocs avec `api.setBlock`. Ces écritures passent par `onWorldChangeBlock` avec `initiatorDbId === null`. Sans garde, le moteur enregistrerait sa propre construction comme une modification de joueur, et les deltas deviendraient un double de la géométrie — ou pire, écraseraient de vraies modifications. La parade : un indicateur `builderWriting` levé pendant chaque lot du constructeur, et deux vérifications (`initiatorDbId === null` **et** `builderWriting`) avant tout enregistrement. Un test simule un tour complet de construction avec les callbacks actifs et exige **zéro** delta créé.

**Limite identifiée.** Un changement provoqué par un autre mécanisme du moteur qui ne passe par aucun callback (par exemple une écriture faite hors code de jeu) ne serait pas capturé. La parade de repli est l'**audit d'intégrité** (§15.6) : toute divergence entre le bloc observé et le bloc attendu (procédural + delta) est enregistrée comme delta `external`. La capture événementielle est donc le chemin rapide, l'audit le filet.

### 15.4 Application sans jamais écraser

Deux protections, pas une :

1. **Barrière d'écriture.** Chaque salle tient un `Set` des cellules modifiées. Le constructeur **saute** ces cellules à toutes les phases. Ce n'est pas « appliquer après », c'est « ne jamais toucher » : la garantie ne dépend plus de l'ordre des passes.
2. **Application après la géométrie.** La passe 6 du constructeur écrit les deltas, après que la géométrie a été posée, dans l'ordre `op` croissant. Elle est idempotente : si le bloc observé vaut déjà `currentBlock`, l'écriture est sautée.

Ainsi, que la salle soit construite pour la première fois, reconstruite après une corruption ou régénérée depuis sa seed, le résultat est identique.

### 15.5 Ordre d'opérations et reprise

Écrire un delta puis appliquer le bloc n'est pas atomique, et les deux peuvent être interrompus :

- si le delta est écrit mais le bloc non appliqué, le rechargement voit un delta non appliqué ⇒ `Recovery` l'applique (idempotent) ;
- si le bloc est écrit mais le delta perdu, l'audit d'intégrité voit une divergence ⇒ delta `external` reconstitué à partir du bloc observé.

Aucun des deux cas ne perd l'information, parce que l'état du monde est toujours lisible et que le delta porte de quoi se réconcilier.

### 15.6 Protection et audit

- **Protection** : `setCantChangeBlockRect(playerId, pos1, pos2)` sur la coque du donjon et sur le lobby, si `protectShell` est actif. La doc déconseille `setCantChangeBlock` sur des milliers de blocs ; la variante `Rect` est prévue pour ça. Attention : protéger une zone interdit d'y créer des deltas — c'est un arbitrage de jeu, exposé en configuration (§20, Q5).
- **Audit d'intégrité** : pour une salle `built`, `Recovery` relit un échantillon déterministe (toutes les cellules de passage + toutes les cellules modifiées + 1 cellule de sol sur `verifySampleRate`) avec `getBlock`, et compare à l'attendu. Divergence ⇒ réparation en une passe, puis nouvelle lecture ; deuxième échec ⇒ `buildState = "failed"` avec motif, et la salle sort des files sans jamais être marquée prête.

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

| Fichier | Ce qui est vérifié |
| --- | --- |
| `tests/dungeon/geometry.test.js` | Conversions `logique ↔ local ↔ monde` aller-retour ; les 4 directions ; formes min et max ; toutes les familles de formes ; formes irrégulières ; plusieurs ouvertures par salle ; contour ; dilatation ; refus des formes déconnectées. |
| `tests/dungeon/openings.test.js` | Cycle de vie complet ; placement refusé dans un angle, sur un trou, trop près d'une autre ; annulation de réservation ; passage à `blocked` après `maxOpenAttempts`. |
| `tests/dungeon/validator.test.js` | Collision réelle contre rectangle englobant (les **deux** sens) ; exemption de marge sur le passage ; `DOOR_MISMATCH` ; `NO_WALKABLE_PATH` ; atomicité : une validation refusée ne laisse aucune trace. |
| `tests/dungeon/index.test.js` | Index contre référence O(n²) sur 500 salles ; verdict identique sur 300 cas ; suppression puis réinsertion ; pas de doublon. |
| `tests/dungeon/generator.test.js` | Reproductibilité des seeds (même seed ⇒ même donjon, ordre d'insertion indifférent) ; unicité des ids ; cohérence des ouvertures et des connexions ; connexion vers une salle existante (boucle) ; génération totalement échouée ; tous les refus produisent un code. |
| `tests/dungeon/anticipation.test.js` | Formule de priorité avec l'exemple A120/C250/B8148/D5285 ⇒ A, C, B, D ; budget de 10 salles par cycle ; anti-doublons des trois files ; suspension des salles lointaines ; « prête » seulement après `built` ; absence de timers natifs. |
| `tests/dungeon/persistence.test.js` | Faux magasin clé/valeur avec **plafond de caractères** et pannes injectées (écriture perdue, écriture partielle, `seq` régressive, `crc` faux) ; reprise sur double tampon ; journal d'opération rejoué une seule fois ; migration `v0 → v1` ; rétention (géométrie retirée puis reconstruite à l'identique). |
| `tests/dungeon/modifications.test.js` | Capture par callback ; les écritures du constructeur ne produisent aucun delta ; les deltas survivent à une reconstruction et à une régénération depuis la seed ; `Air` contre absente ; application idempotente ; delta perdu reconstitué par l'audit. |
| `tests/architecture.test.js` | Aucun `api.` dans les modules logiques ; aucun `setTimeout`/`setInterval`/`Date.now`/`await` dans `src/dungeon/` ; aucune importation d'une couche haute depuis une couche basse. |

### 17.2 La règle de sortie des Phases 1 et 2

Avant toute construction physique, un test d'intégration génère **plusieurs centaines de salles en mémoire** et prouve :

1. **aucune collision** : aucune paire de salles n'a de cellule en commun, y compris après dilatation, hors cellules de passage ;
2. **connexions valides** : chaque connexion référence deux ouvertures existantes, de salles distinctes, alignées, et le passage est réellement franchissable (BFS sur le graphe de cellules local) ;
3. **ids uniques** : aucune collision d'id de salle, d'ouverture, de connexion ;
4. **ouvertures cohérentes** : chaque ouverture `connected` a une connexion qui la cite, chaque connexion `connected` a deux ouvertures ouvertes, aucun `reserved` ne survit à un cycle ;
5. **seeds reproductibles** : deux exécutions avec la même seed produisent des graphes identiques (comparaison structurelle) et une exécution avec une seed différente produit un graphe différent.

Le test tourne pour les huit difficultés du lobby, sur des centaines de salles chacune, et affiche les mesures. Il échoue si l'une des cinq propriétés est violée.

### 17.3 Outil de visualisation logique

`tools/visualize-dungeon.mjs` — hors Bloxd, sans blocs.

```
node tools/visualize-dungeon.mjs --seed 42 --rooms 60
node tools/visualize-dungeon.mjs --seed 42 --rooms 400 --format svg --out out/dungeon.svg
```

- rendu ASCII pour le terminal : cellules de salle, murs, ouvertures avec un symbole par état (`?` pending, `+` connected, `x` blocked), connexions, et le numéro de profondeur dans chaque salle ;
- rendu SVG pour une vue d'ensemble (couleur par profondeur, contour des salles, passage en gras) ;
- une légende et un résumé chiffré (salles, connexions, boucles, profondeur max, refus par code) ;
- mode `--compare` : deux seeds côte à côte, pour vérifier la reproductibilité à l'œil ;
- mode `--failures` : n'affiche que les refus avec leur code et leur position, pour comprendre pourquoi une direction se bloque.

Il utilise exactement les mêmes modules que le jeu, ce qui garantit que ce qu'on voit est ce qui sera construit.

### 17.4 Les huit scénarios de charge

Un harnais unique, `tools/simulate-dungeon.mjs`, avec une fausse API qui mesure au lieu d'écrire. Chaque scénario produit un rapport : salles générées, blocs écrits, coût max d'un tick, latence de file, refus par code.

1. **Exploration simple** — un joueur, ligne droite, 200 salles : aucune salle manquante sous ses pieds, profondeur toujours ≥ 3 devant lui.
2. **Branches multiples** — un joueur qui visite toutes les branches : toutes les branches conservées, aucune perdue, files sans doublon.
3. **Changement de direction** — demi-tour brusque : les salles générées dans l'ancienne direction sont suspendues, pas supprimées, et reviennent à l'approche.
4. **Retour en arrière** — le joueur revient : aucune reconstruction, aucun bloc réécrit inutilement (compteur d'écritures).
5. **Deux joueurs** — séparés puis réunis : aucune duplication de salle, aucune collision, budget partagé équitablement, priorité du plus proche.
6. **Interruption** — coupure au milieu d'une construction : reprise au curseur, aucun bloc sauté, aucun delta perdu.
7. **Redémarrage serveur** — `onClose` puis rechargement complet : graphe identique, états de construction cohérents, deltas réappliqués.
8. **Grande échelle** — 2 000 salles : le coût par cycle ne croît pas avec le nombre total de salles (comparaison des mesures à 200 / 1 000 / 2 000), la mémoire reste bornée, la base reste sous le budget de caractères.

---

## 18. Découpage en phases

Chaque phase est testée avant la suivante. Aucune phase ne commence sans que la précédente ait ses tests verts et son critère de sortie atteint.

| Phase | Contenu | Critère de sortie |
| --- | --- | --- |
| **1. Géométrie** | `DungeonGeometry`, formes procédurales, ouvertures, contours, conversions. | Toutes les formes des huit familles valides ; 400 formes sans forme déconnectée ; visualiseur ASCII opérationnel ; tests géométrie verts. |
| **2. Graphe** | `DungeonGenerator`, `DungeonValidator`, `DungeonSpatialIndex`, `DungeonConnector`, `DungeonManager`, connexions, boucles, réutilisation. | **La règle §17.2 : plusieurs centaines de salles, cinq propriétés prouvées, huit difficultés.** Aucun bloc écrit. |
| **3. Anticipation** | `PlayerTracker`, `DungeonController`, trois files, priorités, budgets, suspension. | Priorités conformes à l'exemple ; budget de 10 salles par cycle respecté ; scénarios 1 à 4 du harnais verts. |
| **4. Construction** | `DungeonBuilder`, `DungeonBuildQueue`, préconditions de chunk, ordre imposé, reprise, vérification. | Salles réellement construites dans Bloxd, sans trou, sans mur plein percé ; scénarios 5 et 6 verts ; reprise au curseur prouvée. |
| **5. Persistance** | `DungeonPersistence`, fragmentation, budget, migration, rétention. | Rechargement identique ; pannes injectées absorbées ; gain de compactage ≥ 3× mesuré ; scénarios 7 et 8 verts. |
| **6. Fiabilité et optimisation** | `DungeonRecovery`, `DungeonModificationTracker` complet, audit, réparation, profilage. | Audit d'intégrité sur 200 salles ; deltas préservés à travers reconstruction et redémarrage ; aucune régression de coût à 2 000 salles. |

Le code du lobby et du spawn (`src/worldCode.js`, la partie spawn de `generator.js`) n'est pas touché avant la Phase 4, où il est rebranché sur le nouveau moteur. Les 26 tests existants restent verts à chaque phase.

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
| 7 | Une modification non passée par un callback serait perdue. | Mur cassé qui réapparaît. | Audit d'intégrité qui reconstitue un delta `external`. | Filet prévu |
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
6. **Rétention.** Acceptes-tu que les salles lointaines, entièrement construites et **sans aucune modification**, voient leur géométrie retirée du stockage et soient régénérées à l'identique depuis leur seed ? C'est la condition pour qu'un donjon infini tienne dans une base finie. Une salle modifiée n'est jamais concernée.

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

`src/dungeon/config.js`, un seul objet exporté, aucune constante numérique dispersée dans les algorithmes.

| Groupe | Paramètre | Défaut |
| --- | --- | --- |
| Dimensions | `minWidth`, `maxWidth` | 4, 10 |
| | `minDepth`, `maxDepth` | 4, 10 |
| | `wallHeight` | 4 |
| | `cellSize` | 1 |
| Passages | `minPassageWidth` | 1 |
| | `passageDepth` (couloir d'approche) | 2 |
| | `minOpeningSpacing` | 2 |
| | `wallThickness` | 1 |
| | `safetyMargin` | 2 |
| | `openingsPerCells` (densité) | 12 cellules de périmètre par ouverture |
| | `maxOpeningsPerRoom` | 8 |
| Génération | `maxAttempts` (par tentative de salle) | 6 |
| | `maxOpenAttempts` (avant `blocked`) | 3 |
| | `maxRoomDimensionSpan` (rayon du donjon) | 2048 cellules |
| | `originStride` | 4096 |
| Anticipation | `triggerDistance` | 30 |
| | `crossingDistance` | 6 |
| | `anticipationDepth` | 3 |
| | `priorityDepthWeight` | 40 |
| | `maxRoomsPerCycle` | 10 |
| | `maxDiscoveryPerCycle` | 40 |
| | `maxBlocksPerCycle` | 800 |
| | `maxOpsPerTick` | 4000 |
| | `cycleTicks` | 20 |
| | `trackerIntervalTicks` | 10 |
| | `backlogThreshold` | 60 salles |
| | `maxAnticipationDistance` | 96 blocs |
| Construction | `blocksPerBatch` | 80 |
| | `chunkWarmupTicks` | 3 (existant, inchangé) |
| | `verifySampleRate` | 8 |
| Persistance | `roomsPerShard` | 32 |
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
