# Architecture — génération par copies de chunks

**Statut : livré.** 4 modules, 58 tests verts, bundle de 17 k caractères sur les 512 k autorisés.

Ce document remplace l'architecture par ouvertures des Phases 0 à 4, supprimée avec son moteur. Il décrit ce qui existe, pas ce qui est prévu : toute divergence entre ce texte et le code est un défaut du texte.

Règles de travail : [`AGENT_RULES.md`](../AGENT_RULES.md).

---

## 1. L'idée, en une phrase

Une salle de donjon est **un chunk Bloxd de 32×32×32**, obtenu en **un seul appel** :

```js
api.copyChunk([srcX, srcY, srcZ], [destX, destY, destZ]);
```

Le générateur ne construit plus rien : il copie. Il n'a donc plus de plan de blocs, de curseur de reprise, d'état d'avancement, d'index spatial, de validateur de géométrie, ni de reprise après redémarrage — tout cela existait pour *construire* une salle bloc par bloc, et disparaît avec cette contrainte.

## 2. Pourquoi ce n'est pas seulement plus court

Le moteur précédent écrivait une salle en ~20 000 `api.setBlock`. Chaque écriture pouvait être perdue silencieusement si le chunk n'était pas chargé, ce qui a produit, dans l'ordre : des trous dans les sols, une boîte de murs autour du joueur pour l'empêcher de tomber, une passe de réparation relisant chaque case, des records de chunk pour reprendre un build interrompu, un garde-temps de tick, des plafonds de mémoire. **Ce sont tous des symptômes du même coût.**

Une copie de chunk supprime le coût, et avec lui la classe de bugs :

| Avant | Maintenant |
| --- | --- |
| ~20 000 `setBlock` par salle, budget de 2 400 blocs/tick | **1** `copyChunk` par salle, 1 par tick |
| Salle à moitié construite si le tick est coupé | Une salle existe ou n'existe pas |
| Reprise après redémarrage : records, curseurs, shards | Une copie idempotente, rejouée si le niveau l'a oubliée |
| Murs mitoyens, linteaux, portes à rouvrir | La porte est dans le modèle, elle ne change jamais |
| Joueur qui tombe dans un chunk vide → boîte de 3 blocs de murs | Gravité coupée le temps de la copie, puis rendue |
| Rayon de 60 blocs, salles de 55 cellules, index par cellule | Grille de chunks autour du joueur |

## 3. Les quatre modules

```
src/dungeon/config.js      toutes les constantes, la table des difficultés
src/dungeon/templates.js   où sont les modèles (coordonnées à remplir), le tirage
src/dungeon/loader.js      la file et la copie
src/dungeon/service.js     entrée dans un niveau, atterrissage, pad, rapports
src/worldCode.js           lobby, pads, commandes /dbg
```

Aucun de ces fichiers ne construit de géométrie, et **aucun n'écrit un bloc** : `loader.js` ne fait que copier, `service.js` que téléporter.

## 4. La boucle de génération

À chaque `tick` du monde (`src/worldCode.js` → `service().tick()` → `loader.tick`) :

1. **Une copie par niveau et par tick**, sans réglage : `placeOne` n'est appelé qu'une fois par niveau et par tick. Une copie coûte 32 768 blocs côté serveur, donc elle n'est jamais doublée dans un tick.
2. **Un scan toutes les 4 ticks** (`scanTicks`). Pour chaque joueur du niveau, les `viewChunks: 2` chunks autour du sien sont examinés, du plus proche au plus loin, et **8 au plus** sont mis en file (`maxPlannedPerScan`).
3. **Un chunk n'est mis en file que si la destination est chargée** (`api.isBlockInLoadedChunk`) **et si la salle n'a pas déjà été copiée dans cette session.** Copier dans un chunk que le serveur n'a pas encore envoyé ne produit aucune erreur : ça ne produit rien du tout.
4. **La salle est retenue comme placée** dès la copie, et comptée comme non vérifiée : le monde ne peut pas être interrogé, donc le compteur ne prétend pas qu'il l'a été.

Il n'y a **aucun état intermédiaire** : une salle est copiée, ou elle ne l'est pas.

## 5. Où vivent les salles : une bande verticale par difficulté

Chaque difficulté possède sa propre couche de chunks, deux chunks sous la précédente :

| Difficulté | Couche (`chunkY`) | Sol (`floorY` du chunk) |
| --- | --- | --- |
| Very Easy | −32 | −1024 |
| Easy | −34 | −1088 |
| Medium | −36 | −1152 |
| Normal | −38 | −1216 |
| Hard | −40 | −1280 |
| Insane | −42 | −1344 |
| Ultra Insane | −44 | −1408 |
| Hell | −46 | −1472 |

Deux conséquences, et ce sont les deux plus gros bugs du moteur précédent qui disparaissent :

- **Deux niveaux ne peuvent jamais se rencontrer.** Une salle remplit tout son chunk ; avec deux chunks d'écart vertical, deux salles ne se superposent jamais, quelle que soit la distance horizontale parcourue. L'ancien moteur posait deux donjons dans la même bande `Y = −1000` et devait espérer qu'ils ne se croisent pas.
- **Le repère du joueur ne dépend plus de son altitude.** Un chunk est sur *sa* couche par construction : le joueur peut sauter, tomber ou être téléporté, la salle reste sur le plan du niveau.

## 6. Entrer dans un niveau

L'ordre est imposé par la plateforme, et il est respecté pas à pas :

1. `warmTemplates` — une lecture par modèle, ce qui demande au serveur d'envoyer ces chunks.
2. Gravité coupée (`gravityMultiplier: 0`), joueur téléporté **dans le chunk vide** de l'entrée. C'est le `setPosition` qui charge ce chunk.
3. `chunkWarmupTicks: 3` ticks plus tard — le chunk existe, mais n'accepte pas encore les écritures.
4. **La salle d'entrée est copiée**, seule, avant tout le reste.
5. Un tick plus tard, le sol de la salle est **relu**. S'il est là, le joueur y est posé, deux blocs au-dessus du bloc de sol ; sinon il est renvoyé au lobby avec la raison.
6. Le pad vers la difficulté suivante est écrit au centre de la salle, et les salles alentour sont mises en file.

Rien n'est annoncé avant que le sol existe.

## 7. Ce qui est lu et écrit dans le monde, et pourquoi

| Opération | Quand | Ce qu'elle remplace |
| --- | --- | --- |
| `getBlock(src)` sur un modèle | avant chaque copie | suppose que `copyChunk` lit un chunk chargé — faux, et silencieux |
| `isBlockInLoadedChunk(dest)` | avant de mettre un chunk en file | suppose qu'une copie dans un chunk non envoyé arrive quelque part |
| `getBlock` en colonne | une fois par niveau | une constante « hauteur du sol » fausse pour un modèle sur dix |

**Le moteur n'écrit jamais un bloc, nulle part.** C'est la contrainte que le propriétaire du projet a posée, et elle simplifie tout : aucune case d'une salle n'est réservée, aucun témoin, aucune plaque, aucune réparation. Les seules opérations autorisées dans un chunk sont `copyChunk` et des lectures.

Le prix, dit franchement : le monde ne peut plus répondre « cette salle est-elle déjà là ? ». Un chunk copié est donc retenu **en mémoire, pour la session** (`level.planned`), ce que `/dbg mem` compte comme posé mais non vérifié. Après un redémarrage, ou quand un joueur revient dans une salle copiée lors d'une autre session, la salle est recopiée une fois. Ce n'est pas un bug : une copie est idempotente, elle réécrit les mêmes blocs aux mêmes cases, pour un seul `copyChunk`.

**Une seule liste de salles, sans identifiant.** Les huit difficultés tirent dans la même liste (`table.rooms`), et une salle est connue par sa position : `#12`. Une difficulté peut ajouter ses propres salles, qui sont tirées avec les communes.

Aucune de ces lectures n'est sur le chemin chaud : un scan lit un bloc par chunk candidat, quatre fois par seconde, pour un joueur immobile. Un joueur qui ne bouge pas et dont les salles sont faites ne coûte **aucune lecture**.

## 8. Mémoire : ce qui peut grandir

| Structure | Plafond | Mécanisme |
| --- | --- | --- |
| `level.queue` | `maxQueued: 96` | un scan s'arrête quand la file est pleine |
| `level.planned` | anneau `viewChunks + 2` | les chunks sortis de l'anneau sont oubliés à chaque scan |
| `planned` des salles **placées** | anneau `viewChunks × 2` | garde la mémoire plus longtemps : revenir sur ses pas ne recopie pas |
| `disabled` | une par salle | une salle illisible est désactivée une fois |
| `playerDungeons` | un par joueur | supprimé par `onPlayerLeave` |

Aucune de ces structures ne dépend du nombre de salles construites.

## 9. Les coordonnées des salles : des chunks

Elles viennent d'une série fournie par le propriétaire du projet : `-2 1 0`, `-4 1 0`, `-6 1 0`…, **en coordonnées de chunk**. Un pas de 1 vaut 32 blocs, donc deux salles voisines sont à 64 blocs et la série est valide telle quelle : chaque salle est un chunk distinct, ce que `copyChunk` exige.

La conversion chunk → bloc se fait dans `chunkToBlock`, à un seul endroit, une seule fois, quand la table est lue : tout le reste du moteur travaille en blocs, parce que c'est ce que `copyChunk` et `getBlock` prennent. Les cas négatifs sont testés explicitement (`-2` → bloc `-64`, et la case `-65` appartient bien au chunk `-3`) : une erreur de frontière décalerait une salle d'un bloc et le joueur atterrirait dans un mur.

Une salle n'a **aucune propriété** : ni portes, ni entrée désignée, ni hauteur. Le tirage est un simple `hash % nombre_de_salles`, et aucune contrainte de connexion n'est vérifiée — le propriétaire du projet a confirmé que les salles se posent au hasard.

## 10. Les trois limites honnêtes

**Un modèle doit être chargé.** `copyChunk` ne fait rien si la source n'est pas chargée, et rien ne le signale. D'où la lecture avant copie, et `/dbg templates` qui dit, modèle par modèle, si sa coordonnée est lisible **maintenant**. Si un modèle reste illisible après `templateReadAttempts: 4` lectures, il est désactivé pour la session et un message est écrit dans le log — jamais une boucle silencieuse.

**Une copie ne dit jamais si elle a réussi.** Le moteur n'écrit rien, donc il ne peut rien relire. Une salle copiée est comptée comme placée pour la session et comme **non vérifiée** (`unverified`) dans `/dbg mem`. Le choix est explicite : ne pas relancer une copie déjà faite, et ne pas prétendre que le monde l'a confirmée.

**Un palier de difficulté doit être construit dans la salle.** Le code ne pose aucune plaque : il lit le bloc sous le joueur (`onBlockStandStart` → `difficultyForPadBlock`) et téléporte. Une salle qui ne contient pas de Concrete du niveau suivant est un cul-de-sac, et c'est le seul contenu qu'une salle doit fournir en plus de sa géométrie.

## 11. Tests

`npm test` — 59 tests.

- `tests/dungeon/config.test.js` — une couche par difficulté, deux chunks d'écart ; un pad = une difficulté ; Hell est le dernier ; le tirage de salle est stable et étalé ; les huit niveaux tirent dans la même liste ; les salles d'un niveau passent avant les communes ; une salle malformée est ignorée sans casser le niveau ; **la conversion chunk → bloc, y compris sur les coordonnées négatives** ; les 15 salles livrées occupent 15 chunks distincts ; une salle ne porte aucune propriété.
- `tests/dungeon/loader.test.js` — un faux serveur où **`copyChunk` depuis un chunk non chargé ne fait rien** et où `getBlock` renvoie `null` hors chunk chargé : la copie est une seule, la file est bornée, une salle n'est jamais recopiée dans la session, une salle illisible est désactivée puis retirée de la file, **aucun bloc n'est écrit nulle part**, rien n'est mis en file pour un chunk non envoyé, la hauteur de sol est lue et non configurée, un niveau vide ne coûte rien.
- `tests/world-code.test.js` — le bundle réel, dans un contexte `vm`, sur un faux serveur qui compte chaque `setBlock` comme une violation : compte à rebours, entrée, atterrissage sur le sol, gravité coupée puis rendue, une plaque Concrete construite dans la salle qui mène au niveau suivant, ordre des copies, joueur qui tombe et qui est reposé, aucun bloc écrit par le code, commandes `/dbg`.

Ce qui n'est **pas** testé, faute de pouvoir l'être hors du jeu : le coût réel d'une copie de chunk côté serveur, et le délai exact au bout duquel un chunk lu devient écrivable. `chunkWarmupTicks: 3` vient de la mesure faite sur le moteur précédent ; si une salle n'arrive pas en jeu, c'est le premier chiffre à augmenter.

## 12. Références Bloxd vérifiées

| Fonction | Signature documentée | Usage |
| --- | --- | --- |
| `api.copyChunk` | `copyChunk(fromPos, toPos)` — « Does nothing if the source chunk is not loaded » | la génération entière |
| `api.getBlock` | `getBlock(x, y, z)` → `BlockName` | lecture du sol des modèles |
| `api.isBlockInLoadedChunk` | `isBlockInLoadedChunk(x, y, z)` → `boolean` | une destination est-elle envoyée par le serveur ? |
| `api.setPosition` | `setPosition(entityId, x, y, z)` ou `(entityId, [x,y,z])` | entrée dans un niveau, retour au lobby |
| `api.setClientOptions` | `setClientOptions(playerId, optionsObj)` | `gravityMultiplier`, pendant tout l'atterrissage |
| `api.isNearInterrupt` | `isNearInterrupt()` → `boolean` | coupe un scan |
| `onBlockStandStart` / `onBlockStandStop` | `(playerId, x, y, z, blockName)` | les pads, lus et jamais posés |
| `onRespawnRequest` | retour `true` pour gérer soi-même | reposer le joueur à l'entrée du niveau |

`getEmptyChunk` et `resetChunk` restent écartés : `resetChunk` n'existe pas dans l'API Reference, et `copyChunk` couvre le besoin avec une fonction documentée.

## 13. Feuille de route

- **Modèles.** Remplir `ROOM_TEMPLATES` (voir §5 de `README.md`), un jeu par difficulté, avec des portes alignées.
- **Variantes.** Le tirage est déjà déterministe par chunk : ajouter un modèle suffit à varier un niveau.
- **Pads dans le donjon.** Aujourd'hui le pad n'est écrit qu'à l'endroit où le joueur atterrit. Le poser aussi dans les salles suivantes revient à écrire 25 blocs par salle visitée — à décider quand le coût d'une copie sera mesuré en jeu.
- **Mobs, minerais, butin.** Aucune de ces fonctionnalités ne dépend de la génération : la structure est un décor figé.
