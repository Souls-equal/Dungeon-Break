# Phase 0 — Audit du dépôt et écart avec les exigences

**Date : 2026-11-08. Branche : `arena/8b066c64-dungeon-break`, sur `51c8e1b`.**

Ce document est un audit, pas une proposition. Il décrit ce que le code fait **réellement**, mesuré quand c'est mesurable, et le compare aux exigences. Rien n'a été modifié dans `src/`.

Trois points d'entrée :

- **la branche est propre** : `docs/ARCHITECTURE.md` est bien présent (contrairement à ce que laissait croire l'absence de `docs/` dans mon cache de session) ;
- **l'audit contredit l'architecture sur des points importants** : c'est le résultat principal, il est détaillé en §5 ;
- **six décisions bloquent la Phase 1**, deux seulement bloquaient l'architecture : §8.
- **Phase 1 livrée** : le moteur hors-ligne existe dans `src/dungeon/engine/` et ses 59 tests passent. Les mesures et les écarts constatés en la construisant sont consignés dans [`ARCHITECTURE.md`](ARCHITECTURE.md) §9.3, §10.4, §11 et §17.1.

---

## 1. Inventaire et état réel du dépôt

### 1.1 Fichiers

| Fichier | Lignes | Rôle | État |
| --- | --- | --- | --- |
| `src/worldCode.js` | 190 | Lobby, pads, compte à rebours, callbacks Bloxd | **Opérationnel** |
| `src/dungeon/generator.js` | 1 583 | Générateur par grille + route streamée + runtime de spawn | **Opérationnel** |
| `src/utils/scheduler.js` | 91 | Horloge à ticks, pas de timers natifs | **Opérationnel**, testé |
| `world-code/worldCode.js` | généré | Bundle collable dans Bloxd | À jour (`npm run check` OK) |
| `tests/*.js` | 970 | 26 tests | **26/26 verts** |
| `tools/build-world-code.mjs` | 107 | Bundle esbuild + garde-fous | Opérationnel |
| `docs/ARCHITECTURE.md` | 977 | Proposition d'architecture (PR #19) | **Non implémentée** |
| `.github/workflows/world-code-sync.yml` | — | CI : `check` + `test` sur PR, rebuild sur `main` | Opérationnel |

### 1.2 Vérifications exécutées

```
npm ci          → 2 paquets, 0 vulnérabilité
npm run check   → "world-code/worldCode.js is up to date"
npm test        → 26 tests, 26 pass, 0 fail
```

### 1.3 Ce qui est réellement opérationnel

Le flux complet fonctionne : un joueur rejoint → il est téléporté au lobby (`onPlayerJoin` → `setPosition`) → il marche sur un pad Concrete → compte à rebours de 10 s annulable → téléportation dans le donjon → attente de chunk → plaque de spawn posée et vérifiée → construction en lots de 80 blocs par tick → audit du sol et réparation → box retirée → salle prête → la route continue à être construite devant le joueur.

C'est une base solide, et les protections de chunk qui y sont codées sont exactement celles que ta section 5.4 demande de conserver. **Elles sont conservées telles quelles.**

### 1.4 Ce qui n'est pas opérationnel

| Fonctionnalité | État |
| --- | --- |
| Persistance | **Absente** : aucun `setLobbyDbValue`, `setPlayerDbValue`, `getPlayerDbId`. Aucune seed conservée. Un redémarrage efface tout. |
| Monde partagé | **Absent** : le donjon est construit **par joueur**, dans ses propres sessions (`dungeonSessions[playerId]`), à une position tirée au hasard. Deux joueurs obtiennent deux donjons différents. |
| Pads de progression | **Absents** : les 8 difficultés existent comme *départs* depuis le lobby. Aucun pad de progression dans un donjon. |
| Salles non linéaires | **Absentes** de la partie streamée : la route est un chemin unique. C'est mesuré en §3.2. |
| Monstres, coffres, minerais | **Absents** (normal, hors périmètre de cette phase). |
| Sortie / fin de donjon | Textuelle seulement : « You reached the edge of the generated dungeon area ». |

### 1.5 Incohérences relevées

1. **`docs/ARCHITECTURE.md` décrit un système qui n'existe pas.** Son §14 (persistance), §12 (files), §13 (builder), §15 (modifications) sont des propositions. Rien de tout cela n'est dans `src/`. Le document est honnête sur ce point (« aucune ligne du moteur n'est implémentée »), mais le README le présente comme « le chantier en cours », ce qui peut laisser croire qu'une base existe.
2. **`docs/ARCHITECTURE.md` prévoit un `DungeonModificationTracker`** (deltas de blocs, §15 en entier, et le module dans la liste des treize). **Ta section 8.3 l'interdit explicitement** : les murs, sols et plafonds ne sont jamais modifiés, donc pas de tracker de destructions. Le document doit être corrigé, pas le code.
3. **La spec des modules d'anticipation a changé** : l'architecture fusionnait « découverte » dans le contrôleur ; ta section 9 demande un module `Discovery` distinct. Ta version est meilleure : c'est lui qui décide quelles ouvertures entrent dans la file, c'est donc une responsabilité à part entière.
4. **`README.md` décrit fidèlement le générateur actuel**, mais parle de « salles à une entrée, couloirs, virages, T, croisements » pour la partie streamée alors que la route streamée est un chemin unique : seuls des couloirs et des virages y apparaissent. Voir §3.2.
5. **Le test « the dungeon is always built within 60 blocks of the player » ne vérifie pas ce qu'il annonce.** Ligne 190 de `tests/world-code.test.js`, la variable `player` est forcée à `null` (`const player = context.api === undefined ? null : null;` puis `void player;`) et la position auditée utilise `spawnX` **constant** au lieu de la position courante du joueur. Le test passe, mais il ne mesure pas la contrainte qu'il décrit. À corriger en Phase 4, quand le builder touchera à cette zone.
6. **Aucun de ces points n'est un bug en jeu** au sens où le jeu tourne. Ce sont des écarts entre ce qui est décrit et ce qui est codé.

---

## 2. Analyse du lobby et du flux de difficultés

| Exigence | Réalité | Écart |
| --- | --- | --- |
| 2.1 Le joueur rejoint toujours le lobby | `onPlayerJoin` téléporte en `[10, 21, 10]`, inconditionnellement | **Conforme** |
| 2.1 Pas de reprise de position | Aucune position n'est persistée | **Conforme** (et le restera : la persistance ne touchera pas à la position) |
| 2.1 Trois difficultés accessibles depuis le lobby | **Les huit** sont accessibles : un pad par difficulté | **Écart** : limite à 3 pads au lobby |
| 2.1 Pads de progression dans le donjon | Inexistants | **À construire** (Phase 4+) |
| 2.1 Le dernier donjon n'a pas de pad supérieur | Sans objet | À prévoir dans la table des difficultés |
| « Ajouter une difficulté facilement » | `DUNGEON_CONFIG.difficultyByBlock` côté lobby + 2 tables de réglage dans le générateur | **Partiellement** : 3 endroits à modifier, dont un dans le générateur. À centraliser dans une seule table ordonnée. |

Le lobby lui-même (pads, grâce de 2 ticks quand on change de pad, annulation, complétion à la dernière seconde) est correct et testé. Je ne le toucherai pas au-delà du filtrage à trois difficultés.

---

## 3. Analyse du générateur actuel, mesurée

Toutes les mesures ci-dessous sont reproductibles avec la seed `24680`.

### 3.1 Grille initiale

| Difficulté | Salles | Portes | Blocs écrits | Chunks touchés | Cellules de roche |
| --- | --- | --- | --- | --- | --- |
| Very Easy | 8 | 15 | 3 459 | 1 | 643 |
| Easy | 12 | 24 | 5 379 | 2 | 1 016 |
| Medium | 16 | 37 | 4 887 | 2 | 799 |
| Normal | 22 | 52 | 7 115 | 7 | 1 196 |
| Hard | 28 | 57 | 8 172 | 6 | 1 280 |
| Insane | 34 | 72 | 13 219 | 8 | 2 386 |
| Ultra Insane | 40 | 91 | 14 609 | 7 | 2 577 |
| Hell | 48 | 102 | 18 514 | 8 | 3 327 |

**Coût mesuré** : créer un donjon Hell complet (génération + itération de tous les blocs) prend **11 ms**. En un seul tick, sur un budget de 50 ms, c'est 22 % du tick consommé d'un coup pour 18 514 blocs. C'est précisément ce que le nouveau moteur doit éviter : la génération doit être produite salle par salle, sous budget, jamais en bloc.

### 3.2 La route streamée est un chemin, pas un réseau

C'est le constat le plus important de l'audit, et il confirme ton diagnostic.

Sur 12 modules streamés consécutifs :

- **25 portes** au total, dont **24 sont l'entrée et la sortie** du chemin ;
- **1 seule porte latérale** a été tirée (probabilité 14 %), et elle **ne mène nulle part** : ni sol, ni salle derrière, ni connexion enregistrée ;
- **1 seul module sur 12** possède plus de deux portes ;
- **une seule branche est développée** : celle du dernier `exit` ;
- tous les modules font **exactement 7×7**.

Autrement dit : la partie streamée n'est pas un donjon, c'est un couloir qui tourne. Les exigences 3.2 (variété de formes), 4.1 (toutes les ouvertures développables), 4.2 (réutilisation), 4.3 (boucles) et 5.1 (anticipation toutes branches) sont **toutes** non satisfaites, et aucune ne peut l'être par une retouche : le modèle de données ne les permet pas.

Pourquoi : un module n'a que deux ouvertures « utiles » (entrée, sortie) et la troisième, quand elle existe, est un trou percé dans un mur sans salle en face. La porte existe comme booléen `ports.side`, pas comme objet avec identité, état et connexion.

### 3.3 Défauts de conception de la géométrie actuelle

1. **Les murs sont posés sur la face extérieure de chaque salle**, donc deux salles adjacentes empilent **deux murs** et se retrouvent séparées par deux blocs pleins là où il n'y a pas de porte. Vérifié : `A.z+6 = 37` et `B.z = 31` pour des modules qui se touchent, avec les murs de A sur `z = 31` et `z = 37`, ceux de B sur `z = 31` et `z = 37`.
2. **Conséquence : les salles ne peuvent pas être directement adjacentes.** La connexion directe demandée en 3.1 n'est pas représentable dans le modèle actuel : il faut une case de couloir entre deux salles, ce que le code appelle `ROOM_CONNECTION_GAP = 1`.
3. **Collision en rectangles englobants uniquement** (`roomBoxesClash`) : deux salles en L dont les boîtes se chevauchent mais pas les cellules sont refusées à tort. C'est exactement le cas que ta section 6 interdit. Mesuré : **5,2 ms pour 200 choix** avec 2 000 salles déjà posées, soit ~26 µs par choix et une croissance linéaire — c'est déjà un coût O(n) par module.
4. **La vérification de collision est en O(n)** sur `session.occupiedRooms`, parcouru à chaque candidat de direction. Avec 2 000 salles, un seul choix de module parcourt toute la liste. Ta section 11 l'interdit.
5. **Les ouvertures ne sont pas des objets** : `ports = { north: true, east: false, … }`. Pas d'identifiant, pas d'état, pas de largeur, pas de position. La connexion n'est pas enregistrée : elle est déduite de la géométrie. Ta section 3.1 (« une proximité ne doit jamais être considérée comme une connexion ») est violée par construction.
6. **La profondeur et les boucles n'existent pas** : il n'y a pas de graphe, seulement une liste d'occupation.

### 3.4 Déterminisme

- `makeRandom(seed)` est un PRNG **local** (congruence linéaire), correct : aucun état global partagé dans la génération. C'est un point acquis, réutilisable.
- **Mais la seed du donjon n'est pas reproductible** : `nextDungeonSeed()` utilise `api.now()`, plus un compteur de module. Deux joueurs ne peuvent pas rejouer un donjon, et un redémarrage le perd définitivement.
- La seed de module est dérivée d'un index (`session.streamRoomIndex`), donc dépend de l'ordre d'exploration : la géométrie d'une salle change si le joueur prend une autre route.
- Aucune seed n'est persistée.

### 3.5 Construction et protections de chunk

Ce qui est **déjà correct et à conserver** :

| Protection | Implémentation | Emplacement |
| --- | --- | --- |
| Lecture initiale du chunk | `readBlockName` avant la téléportation, sans écriture dans le même tick | `teleportAndBox` |
| Délai de chargement | `chunkWarmupTicks = 3` balayages avant la première écriture | `startSpawnGuard` |
| Vérification des chunks | `isBlockInLoadedChunk` **non utilisée** aujourd'hui ; le rayon `generationRadius = 60` sert de substitut | à brancher sur `isBlockInLoadedChunk` |
| Construction par lots | 80 blocs par tick (`blocksPerTick`), testé à ≤ 120 | `startBlockBuild` |
| Vérification du résultat | relecture `getBlock` + réparation (`repairFloorTiles`, `missingSpawnPadTiles`) | `startBlockBuild`, `startSpawnGuard` |
| Réparation des écritures perdues | réécriture des tuiles divergentes, avec repli « tout réécrire » si la lecture échoue | `repairFloorTiles` |
| Reprise | **partielle** : le curseur n'est pas persisté, une coupure perd la salle en cours | à faire |

`isBlockInLoadedChunk` est documentée et disponible ; le code actuel ne s'en sert pas. La construction future l'utilisera comme précondition, en complément du rayon.

### 3.6 Absence de persistance

Aucun appel à une DBValue dans `src/`. Conséquences concrètes :

- un redémarrage du serveur perd le donjon en cours ;
- un joueur ne peut pas retrouver son donjon ;
- « retour en arrière après redémarrage » (exigence 4.3) est **impossible aujourd'hui**.

---

## 4. Ce qui est réutilisable

| Élément | Verdict |
| --- | --- |
| `src/utils/scheduler.js` | **Conservé tel quel.** Horloge unique, testée, sans timers natifs. |
| Séquence de spawn (lire → téléporter → attendre → plaque/box → construire) | **Conservée**, c'est la correction du bug « trous » et ta section 5.4 l'exige. |
| `repairFloorTiles`, `readBlockName`, audit après écriture | **Conservés**, généralisés à la vérification de salle. |
| Lobby, pads, compte à rebours, grâce inter-pads | **Conservés**, avec filtrage à trois difficultés. |
| `makeRandom` (PRNG local) | **Conservé** comme brique, mais remplacé par un hash d'identité pour les salles. |
| `blockKey`, itérateurs de blocs, `boxWallBlocks` | Conservés en Phase 4. |
| `createDungeonPlan`, `makeDungeonLevel`, `makeConnections`, `portsFor`, `pickRoomCells`, `middleCellIndex` | **Remplacés** : la grille rigide disparaît. |
| `chooseStreamedModule`, `pickStreamedExit`, `createStreamedModulePlan`, `buildNextStreamRoom`, `continueStreaming`, `exitCorridorCell`, `roomBoxesClash`, `moduleDistanceFrom` | **Remplacés** : le chemin unique disparaît au profit du réseau par ouvertures. |
| Escaliers (`stairBlocks`, `STAIR_PROFILE`) | **Ne pas reporter en Phase 1** : les différences de niveau sont explicitement « si introduites ultérieurement ». |

---

## 5. Écarts avec `docs/ARCHITECTURE.md`

L'architecture de la PR #19 reste valable sur le fond (ouvertures, graphe, validation en cellules, index, trois files, persistance fragmentée). **Six points doivent être corrigés avant d'implémenter**, et deux ne sont pas de simples détails.

| # | Sujet | Architecture (PR #19) | Ta nouvelle spec | Décision |
| --- | --- | --- | --- | --- |
| 1 | **Murs indestructibles** | `DungeonModificationTracker` complet : deltas, capture `onPlayerChangeBlock`, audit, réparation (§15 entier) | 2.3 et 8.3 : **aucune** modification structurelle, pas de tracker de destructions | **La spec gagne.** Le module disparaît de la Phase 1-6. Reste utile plus tard pour les **minerais**, sous une autre forme (voir §8, Q3). |
| 2 | **Pads de progression** | Absents de l'architecture | 2.1 : éléments de jeu, distincts des ouvertures | **À ajouter** comme concept de premier ordre : une salle peut porter un pad, non connecté aux ouvertures, protégé, lié à la difficulté suivante. |
| 3 | **Modules** | 13 modules, `ModificationTracker` inclus, découverte fondue dans le contrôleur | Liste proche + `Discovery` distinct | **Liste de ta section 9 retenue** : `Discovery` séparé, `ModificationTracker` retiré. 12 modules. |
| 4 | **Lieu d'ouverture de la connexion** | La connexion `direct` exige des cellules d'ouverture **exactement adjacentes**, et le mur est chez chaque salle (épaisseur 1) | 3.1 : connexions directes, salles adjacentes | **Doit être tranché** : deux maçonneries de 1 bloc ne peuvent pas être adjacentes sans fusionner leurs murs. Voir §8, Q1 — c'est la décision la plus structurante. |
| 5 | **`safetyMargin = 2`** | Marge de 2 cellules partout, exemptée sur le rectangle de passage | Murs indestructibles, connexions directes | La marge de 2 **empêche deux salles d'être voisines**, donc toute connexion directe. Elle doit devenir une marge de **non-chevauchement structurel**, pas une distance entre parois. Voir §8, Q1. |
| 6 | **Rétention par régénération** | Salles lointaines non modifiées : géométrie retirée, reconstruite depuis la seed | 8.1 : conserver les salles et « les informations permettant de reconstruire » | **Compatible**, et même simplifié : sans deltas de structure, la reconstruction depuis la seed est **exacte par construction**. C'est un gain direct de ta règle 8.3. |

Autres ajustements mineurs, sans blocage :

- la règle 8.2 (fragments versionnés, détection de corruption, écritures ciblées) reprend l'architecture telle quelle ;
- la règle 8.4 (le joueur retourne toujours au lobby, la persistance du monde est indépendante) est **déjà le comportement actuel** et le restera ;
- la règle 11 (statistiques) demande onze compteurs ; l'architecture n'en prévoyait que six. À compléter.

---

## 6. Contraintes Bloxd vérifiées pour ce travail

Contrôle de présence et de signature le 2026-11-08 sur la documentation officielle (`bloxd.io/docs`, miroir `github.com/Bloxdy/code-api`).

| Fonction | Présente | Signature vérifiée | Remarque |
| --- | --- | --- | --- |
| `api.getBlock` | oui | `(x, y, z)` ou `([x,y,z])` → `BlockName` | |
| `api.setBlock` | oui | `(x, y, z, blockName)` ou `([x,y,z], blockName)` | |
| `api.isBlockInLoadedChunk` | oui | `(x, y, z)` → `boolean` | **Non utilisée par le code actuel** ; à brancher |
| `api.getPlayerDbId` | oui | `(playerId)` → `PlayerDbId` | Identifiant stable, seule clé de persistance acceptable |
| `api.getPlayerDbValue` | oui | `(playerId, key)` → `string \| number \| null` | |
| `api.setPlayerDbValue` | oui | `(playerId, key, value: string \| number)` | Pas d'objet : sérialisation obligatoire |
| `api.getLobbyDbValue` | oui | `(key)` → `string \| number \| null` | |
| `api.setLobbyDbValue` | oui | `(key, value: string \| number)` | |
| `api.getPlayerIds` | oui | `()` → `PlayerId[]` | |
| `api.getPosition` | oui | `(entityId)` → `[x, y, z]` | |
| `api.setPosition` | oui | `(entityId, x, y, z)` ou `(entityId, [x,y,z])` | |
| `api.blockCoordToChunkId` | oui | `(pos: number[])` → `string` | **Attention** : ne s'appelle pas `getBlockCoordToChunkId`. Le nom cité dans ta section 10 n'existe pas sous cette forme. |
| `api.chunkIdToBotLeftCoord` | oui | `(chunkId)` → `[x, y, z]` | |
| `api.getLobbyName` | oui | `()` → `string` | |
| `api.getVariation` | oui | `()` → `string` | Utile pour la clé de persistance |
| `api.setBlockRect` | oui | `(pos1, pos2, blockName)` | Écriture de sol en un appel |
| `api.getBlockId` | oui | `(x, y, z)` → `BlockId` | Pour les chemins chauds |
| `api.getBlockSolidity` | oui | → `boolean` | **Piège** : renvoie `true` pour un chunk **non chargé**. Ne jamais l'utiliser pour valider. |
| `api.getBlockData` / `setBlockData` | oui | — | **Inutilisables pour persister** : effacé au changement de bloc |
| `api.getChunk` / `resetChunk` | **non documentées** | — | `getEmptyChunk` mentionne `resetChunk`, qui n'existe pas dans la référence : écriture par chunk **écartée** |
| Timers natifs | **non documentés** | — | Scheduler à ticks obligatoire |
| `await` / `Promise` | non garantis | — | Interdits par `AGENT_RULES.md` |

**Limite de taille des DBValues : toujours pas documentée.** La seule mention reste indirecte (`setCurrency` : « count towards db length limits »). Conséquence inchangée : budget de caractères mesuré avant écriture, fragmentation, et reconstruction depuis la seed comme filet.

---

## 7. Ce que la Phase 1 doit produire

Périmètre strict, aucune écriture de bloc :

1. **`Geometry`** — formes procédurales en cellules, indépendantes des blocs : rectangulaire, carrée, allongée, L, T, croix, irrégulière, composée, avec renfoncements et rétrécissements. Dimensions min/max et complexité paramétrables. Connexité garantie, contours calculés, aucune partie déconnectée.
2. **Ouvertures** — objets avec identifiant, position, direction, largeur, hauteur, état. Placement validé : sur le contour réel, largeur de passage suffisante, distance aux angles, espacement entre ouvertures, couloir d'approche inclus dans la forme.
3. **Validateur géométrique** — collisions en cellules réelles, épaisseur de mur, marge de non-chevauchement, compatibilité d'alignement de deux ouvertures face à face, franchissabilité par parcours sur cellules marchables.
4. **Index spatial** — grille de hachage des salles + index des ouvertures, testés contre une référence en O(n²).
5. **Visualisation** — outil hors Bloxd, ASCII et SVG, avec seed imposée, profondeurs et refus.
6. **Tests** — formes, rotations, dimensions extrêmes, ouvertures, contours, marges, collisions, connexions directes, accessibilité à pied.

Critère de sortie : plusieurs centaines de formes générées, aucune collision, aucune forme déconnectée, accessibilité prouvée, index conforme à la référence, tests verts.

Ce qui **n'entre pas** en Phase 1 : le graphe (Phase 2), les files (Phase 3), tout `api.*` (Phase 4), la persistance (Phase 5). Le module `Geometry` doit être utilisable sans Bloxd — c'est le critère qui garantit qu'il n'y aura pas de dépendance cachée.

---

## 8. Décisions bloquantes

Deux sont véritablement bloquantes pour la Phase 1 ; les quatre autres peuvent attendre la Phase 4, mais autant les trancher maintenant.

### Q1 — Épaisseur des murs entre deux salles (BLOQUANT)

Deux salles directement adjacentes partagent-elles **un seul mur** (une épaisseur commune, de 1 bloc) ou chacune possède-t-elle **son propre mur** (2 blocs pleins entre les deux, avec un passage qui les traverse) ?

- **Un seul mur partagé** : les salles se touchent vraiment, c'est ce que « connexion directe » décrit naturellement, et cela économise des blocs. Mais le mur appartient à deux salles : qui le construit, et que se passe-t-il si l'une est construite avant l'autre ? Il faut une règle de propriété (le constructeur de la salle la plus proche du joueur, ou le premier arrivé, ou une passe de « murs partagés » séparée) et le test d'intégrité doit tolérer qu'un mur soit écrit par deux salles.
- **Deux murs** : chaque salle est autonome, construite et réparée indépendamment, sans coordination. Mais l'épaisseur de 2 blocs est visible, et la marge de sécurité doit être ≥ 2, ce qui interdit toute autre adjacence.

Ma recommandation : **mur partagé**, avec une passe de construction dédiée aux murs mitoyens, décidée par le graphe (une arête = un mur mitoyen, propriétaire = l'une des deux salles selon un ordre déterministe). C'est ce qui donne les meilleurs donjons, mais c'est un choix de conception, pas une évidence technique.

### Q2 — Mode de persistance (BLOQUANT)

Donjon **partagé** par tous les joueurs du serveur, **individuel** par joueur, ou **hybride** ? Cela détermine si deux joueurs peuvent se rencontrer dans le même donjon, et donc si les boucles et raccourcis ont un sens collectif. La clé changera : `getLobbyDbValue` (partagé) ou `getPlayerDbValue` sur `getPlayerDbId` (individuel).

Remarque nouvelle, qui découle de ta règle 2.3 : **sans modifications structurelles, l'hybride de l'architecture n'a plus d'objet.** Le graphe étant identique pour tous et le monde immuable, le donjon partagé devient *beaucoup* plus simple qu'avant. C'est un argument fort pour le Mode A, que je ne pouvais pas formuler avant.

### Q3 — Minerais : blocs ou champs ?

Les minerais « ne devront jamais être considérés comme des blocs structurels ». Deux implémentations possibles : de vrais blocs dans les murs, dont la récolte serait un delta (ce qui réintroduit un tracker, mais limité aux minerais) ; ou des filons décrits par la donnée, posés à la construction et dont le seul état persistant est « récolté ou non » (un bit par filon, bien moins coûteux). Pas bloquant pour la Phase 1, mais le choix influence le format de persistance.

### Q4 — Trois difficultés au lobby : comment ?

Filtrer les octets de pads existants, ou construire trois pads et laisser les autres dans le monde sans effet ? La seconde option demande de décider quoi faire d'un joueur qui monte sur un pad « Normal » au lobby.

### Q5 — Pad de progression : lié à quoi ?

Un pad existe-t-il dans **toutes** les salles d'une certaine catégorie (par exemple les culs-de-sac), ou est-il unique par donjon et placé dans une salle désignée ? Cela décide s'il est un élément de salle ou un élément de donjon, et donc où il est persisté.

### Q6 — Le donjon se termine-t-il ?

Un donjon peut être infini (on explore sans fin) ou borné (on atteint le pad de la difficulté suivante, qui est la fin). Cela change les critères de « fin de donjon » et le message de fin de la route streamée actuelle.

---

## 9. Plan proposé pour la suite

1. **Corriger `docs/ARCHITECTURE.md`** selon §5 (retirer le tracker de modifications, ajouter les pads, remplacer la liste de modules, ajuster marge et rétention). Court, et évite de coder contre un document faux.
2. **Implémenter la Phase 1** (géométrie, ouvertures, validateur, index, visualisation), avec ses tests.
3. **Publier la Pull Request** avec les tests verts et les 26 existants préservés.
4. Continuer phase par phase, sans anticiper.

Aucune ligne de `src/` n'est modifiée tant que Q1 et Q2 ne sont pas tranchées, parce que la réponse change la structure des données de la Phase 1 (un mur partagé ou deux, une marge de 1 ou de 2) et le format de persistance de la Phase 5.
