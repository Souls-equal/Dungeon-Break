# Architecture — génération par copies de chunks

**Statut : livré.** 4 modules, 71 tests verts, bundle de 21 k caractères sur les 512 k autorisés.

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
| Reprise après redémarrage : records, curseurs, shards | Le Bedrock de la salle répond « elle est déjà là » |
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

1. **Une sonde par chunk à copier** (`probeChunk`) : un `getBlock` au centre du chunk destination (local 16,16), sur la première couche puis sur la dernière. Trois réponses, et c'est toute la mécanique de chargement : `null` → le chunk n'est pas envoyé, et cette lecture **est** la demande ; Bedrock → la salle est déjà là ; autre chose (Air, terre, pierre) → le chunk est là et ce n'est pas une salle, donc la copie se fait.
2. **Un scan toutes les 4 ticks** (`scanTicks`). Pour chaque joueur du niveau, les `viewChunks: 1` chunks autour du sien sont examinés, du plus proche au plus loin, et **8 au plus** sont mis en file (`maxPlannedPerScan`).
3. **Un chunk demandé n'est copié qu'à `tick + chunkLoadTicks: 2`.** C'est la mesure faite en jeu : deux ticks après le `getBlock`, le chunk existe et accepte une copie.
4. **Une copie par entrée et par tick**, sans réglage : `placeOne` n'est appelé qu'une fois par entrée et par tick, et une copie se termine en moins d'un tick.
5. **La copie est relue au tick suivant**, jamais dans le tick où elle est faite : une salle comptée est une salle que le monde montre. Une salle toujours invisible après `chunkLoadTicks` est une salle ratée : elle est comptée en échec et le scan suivant la remet en file.

Il n'y a **aucun état intermédiaire** : une salle est là, ou elle n'est pas là — et c'est son Bedrock qui le dit.

## 5. Où vivent les salles : plus de bande réservée

Il n'y a **plus de hauteur par difficulté**. Le moteur a d'abord donné à chaque difficulté sa bande verticale (Very Easy en `chunkY = −32`, Easy en −34, etc.), ce qui garantissait que deux niveaux ne se superposent jamais. C'était une bonne réponse à la mauvaise question : deux *joueurs* du même niveau se rencontraient toujours, puisque le niveau était construit une fois, à un endroit fixe.

La hauteur est donc devenue une composante de l'origine tirée par entrée (§5bis), comme `x` et `z` :

- `x`, `z` en chunks dans `−3125..3124`, soit **±100 000 blocs** ;
- `y` en chunks dans `32..3124`, soit **blocs 1 000 à 100 000** — la plage donnée par le propriétaire. Le plancher à 32 chunks n'est pas décoratif : il interdit de tirer un donjon à `y = 0`, là où vit le monde normal d'un jeu.

Une salle remplit tout son chunk, et `spawnSeparation: 20 000` blocs est vérifiée sur les **trois** axes : deux donjons sont donc au moins 20 000 blocs plus loin l'un de l'autre, dans n'importe quelle direction.

**Le repère du joueur ne dépend plus de son altitude.** Le moteur ne lit jamais la hauteur d'un niveau dans une table : il lit `level.origin.y`, l'origine du donjon où il se trouve. Copie, sonde, atterrissage, sauvetage et `/dbg` passent tous par ce nombre — un donjon à `y = 835` et un donjon à `y = −32` sont le même code.

## 5bis. Un donjon par entrée, et une origine tirée à chaque fois

Deux joueurs ne doivent **jamais** se croiser. Ce n'est pas une question de chance : c'est une
contrainte du moteur, et elle tient en une décision.

**Chaque entrée tire sa propre place.** Le premier état du moteur était un donjon par
difficulté, construit à une origine fixe : la deuxième personne à prendre la même plaque
arrivait dans les salles de la première. Il n'y a plus d'état par difficulté mais **un état par
entrée** (`states`, une `Map` par `entryId`), et `claimOrigin` tire `x` et `z` en chunks dans
`spawnChunkMin..spawnChunkMax` — soit **−3125..3124 chunks, ±100 000 blocs**, la plage demandée
par le propriétaire du projet, `y` étant tiré lui aussi dans la plage qu'il a donnée (blocs 1 000 à 100 000).

Le tirage n'est pas aveugle : une origine est acceptée si sa distance de Chebyshev, en chunks,
à **toutes** les origines vivantes est au moins `ceil(spawnSeparation / 32) = 625` chunks
(`spawnSeparation: 20 000` blocs). Sinon `spawnDraws: 24` essais, et la plus éloignée l'emporte.
La distance est calculée sur **les trois axes** : `x`, `y` et `z` comptent pareil. Deux donjons
actifs sont donc à 20 000 blocs l'un de l'autre au minimum, dans n'importe quelle direction, et
les joueurs ne peuvent pas se rencontrer — ni à pied, ni en creusant, ni en sautant.

**Quitter libère la place.** `leave` détruit l'état de l'entrée ; le tirage suivant peut
réutiliser cette zone. Un donjon abandonné ne consomme donc ni mémoire ni espace, et rien n'est
écrit dans les chunks — le nettoyage de la carte est un réglage du jeu, pas du code.

**Ce qui reste partagé** : `disabled`, la liste des modèles illisibles. C'est une propriété du
monde, pas d'un donjon : une salle qu'aucune lecture n'atteint est illisible pour tout le monde.

## 6. Entrer dans un niveau

L'ordre est imposé par la plateforme, et il est respecté pas à pas :

1. `warmTemplates` — une lecture par modèle, ce qui demande au serveur d'envoyer ces chunks.
2. `claimOrigin` — la place de cette entrée, `x`, `y` et `z` : un nouveau tirage (`newOrigin`) à chaque descente, et l'ancien état est libéré.
3. Gravité coupée (`gravityMultiplier: 0`), joueur téléporté **dans le chunk vide** de l'entrée. C'est le `setPosition` qui charge ce chunk.
4. `chunkLoadTicks: 2` ticks plus tard, le chunk existe et accepte une copie.
5. **La salle d'entrée est copiée** dans le chunk de cette entrée. C'est la sonde qui tranche, pas un compteur : si une salle y est déjà, rien n'est recopié.
6. Un tick plus tard, l'atterrissage est **tiré** et le sol sous la position est relu. S'il est là, le joueur y est posé. Sinon la copie est retentée, `entryMaxTicks: 4` fois au total, puis le joueur est renvoyé au lobby avec la raison.

**L'atterrissage est tiré au hasard, et sa hauteur est celle de la salle copiée.** Deux bugs étaient ici, et ils expliquent un joueur dans le sol :

- la hauteur du sol venait du **premier modèle de la liste**, alors que `templateFor` tire une salle par chunk : l'entrée prend souvent une autre salle, avec un sol à une autre hauteur (2 pour l'une, 7 pour l'autre — et 7 est la bonne sur ce monde). La hauteur est maintenant lue dans `level.entrance`, la salle qui a réellement été copiée ;
- la position était fixe, au centre de la salle : deux joueurs sur la même plaque apparaissaient l'un sur l'autre. Elle est maintenant tirée dans `landingMargin = 4` cellules, donc jamais contre les murs, et les deux cases au-dessus de la colonne doivent être vides — sinon un autre tirage. Un joueur ne peut donc pas apparaître dans un mur. Deux joueurs, eux, ne se croisent plus du tout : chacun a son propre donjon (§5bis).

La colonne est lue **dans le modèle**, pas dans la destination : au moment du tirage, la destination n'est pas encore copiée, donc elle ne contient que de l'Air. La copie conserve la disposition verticale, donc la hauteur lue dans la salle est exacte à l'arrivée.

7. Les salles alentour sont mises en file, autour de l'origine de cette entrée.

Rien n'est annoncé avant que le sol existe, et aucune plaque n'est posée : celle qui mène au niveau suivant est dans la salle.

## 7. Ce qui est lu et écrit dans le monde, et pourquoi

| Opération | Quand | Ce qu'elle remplace |
| --- | --- | --- |
| `getBlock` sur le Bedrock d'un chunk | avant chaque copie, puis au tick suivant | « je suppose que le chunk est chargé », et « je suppose que la copie a réussi » |
| `getBlock(src)` sur un modèle | avant chaque copie | suppose que `copyChunk` lit un chunk chargé — faux, et silencieux |
| `getBlock` en colonne | une fois par entrée | une constante « hauteur du sol » fausse pour un modèle sur dix |

**Le moteur n'écrit jamais un bloc, nulle part.** C'est la contrainte que le propriétaire du projet a posée, et elle simplifie tout : aucune case d'une salle n'est réservée, aucun témoin, aucune plaque, aucune réparation. Les seules opérations autorisées dans un chunk sont `copyChunk` et des lectures.

**Une seule case est lue, et seule la lecture de Bedrock compte.** C'est la correction d'un vrai bug en jeu : la première version sondait quatre colonnes et acceptait *n'importe quel* bloc non-Air comme preuve d'une salle. Du terrain ordinaire à la profondeur du niveau suffisait alors à faire croire que la salle d'entrée existait déjà — la copie était sautée, et le joueur recevait « The room could not be built ». Le moteur ne lit plus qu'une case, au centre du chunk, et il n'accepte que le Bedrock comme preuve.

**Le record d'une salle, c'est son Bedrock.** La contrainte « on n'écrit rien » n'aveugle pas le moteur, parce que chaque salle porte sa propre preuve : une couche de Bedrock en bas et une en haut du chunk, sol et plafond, comme les Bedrock du Nether. Une seule lecture répond donc à deux questions — et c'est le propriétaire du projet qui l'a formulé ainsi : si une couche n'a pas de Bedrock, il suffit que le bloc ne soit pas de l'Air.

Pourquoi c'est important, dit franchement : la réponse vient du **monde**, pas d'un compteur en mémoire. Après un redémarrage, ou quand un joueur revient dans une salle copiée lors d'une autre session, la salle est reconnue et n'est pas recopiée. Aucun bloc n'a été écrit pour cela.

**Une seule liste de salles, sans identifiant.** Les huit difficultés tirent dans la même liste (`table.rooms`), et une salle est connue par sa position : `#12`. Une difficulté peut ajouter ses propres salles, qui sont tirées avec les communes.

Aucune de ces lectures n'est sur le chemin chaud : un scan lit un bloc par chunk candidat, quatre fois par seconde, pour un joueur immobile. Un joueur qui ne bouge pas et dont les salles sont faites ne coûte **aucune lecture** — sauf les salles copiées au tick précédent, une lecture chacune, le temps de les voir apparaître.

## 8. Mémoire : ce qui peut grandir

| Structure | Plafond | Mécanisme |
| --- | --- | --- |
| `level.queue` | `maxQueued: 96` | un scan s'arrête quand la file est pleine |
| `level.planned` | anneau `viewChunks + 2` | les chunks sortis de l'anneau sont oubliés à chaque scan |
| `planned` des salles **placées** | anneau `viewChunks × 2` | garde la mémoire plus longtemps : revenir sur ses pas ne recopie pas |
| `level.ready` / `level.placingSince` | l'anneau du scan | une entrée par chunk demandé ou copié, supprimée dès qu'elle a servi |
| `disabled` | une par salle | une salle illisible est désactivée une fois |
| `playerDungeons` | un par joueur | supprimé par `onPlayerLeave` |
| `states` (une par entrée) | une `Map` de chunks par entrée | l'état entier est détruit par `release`, donc aucune origine ne survit à un départ |

Aucune de ces structures ne dépend du nombre de salles construites.

## 9. Les coordonnées des salles : des chunks

Elles viennent d'une série fournie par le propriétaire du projet : `-2 1 0`, `-4 1 0`, `-6 1 0`…, **en coordonnées de chunk**. Un pas de 1 vaut 32 blocs, donc deux salles voisines sont à 64 blocs et la série est valide telle quelle : chaque salle est un chunk distinct, ce que `copyChunk` exige.

La conversion chunk → bloc se fait dans `chunkToBlock`, à un seul endroit, une seule fois, quand la table est lue : tout le reste du moteur travaille en blocs, parce que c'est ce que `copyChunk` et `getBlock` prennent. Les cas négatifs sont testés explicitement (`-2` → bloc `-64`, et la case `-65` appartient bien au chunk `-3`) : une erreur de frontière décalerait une salle d'un bloc et le joueur atterrirait dans un mur.

Une salle n'a **aucune propriété** : ni portes, ni entrée désignée, ni hauteur. Le tirage est un simple `hash % nombre_de_salles`, et aucune contrainte de connexion n'est vérifiée — le propriétaire du projet a confirmé que les salles se posent au hasard.

## 10. Les trois limites honnêtes

**Un modèle doit être chargé.** `copyChunk` ne fait rien si la source n'est pas chargée, et rien ne le signale. D'où la lecture avant copie, et `/dbg templates` qui dit, modèle par modèle, si sa coordonnée est lisible **maintenant**. Si un modèle reste illisible après `templateReadAttempts: 4` lectures, il est désactivé pour la session et un message est écrit dans le log — jamais une boucle silencieuse.

**Une copie ne se confirme pas dans son propre tick.** Le moteur n'écrit rien, donc ce qu'il peut relire n'est que ce que le serveur a appliqué — c'est-à-dire le tick suivant. Une salle copiée est donc comptée **en vol** (`in flight`) jusqu'à ce que la sonde la voie ; une salle toujours invisible après `chunkLoadTicks` est comptée en échec et le scan suivant la remet en file. `/dbg mem` sépare les trois nombres, et aucun ne prétend être une preuve qu'il n'est pas.

**Un chunk n'est copiable que deux ticks après la lecture qui l'a demandé.** C'est une mesure, pas une marge : `chunkLoadTicks: 2`. Si une salle n'arrive jamais en jeu, c'est le premier chiffre à augmenter — et il n'y a qu'un endroit à changer.

**Une entrée qui échoue dit pourquoi.** Le message du joueur n'est pas générique : `entranceFailureMessage` lit l'état réel et nomme la cause — modèle non chargé (avec son chunk), chunk d'entrée illisible, salle déjà présente donc rien n'a été copié, hauteur de sol introuvable, ou « la copie n'a pas atterri » avec les deux lectures. `/dbg level` affiche les mêmes faits pour une capture d'écran.

## 7bis. Pourquoi une entrée échoue, et ce que le message dit

Quand la salle d'entrée n'arrive pas, le joueur reçoit une raison, pas un constat. `entranceFailureMessage` relit l'état réel et nomme la cause : modèle non chargé (avec le chunk à vérifier), chunk d'entrée illisible, salle déjà présente donc rien n'a été copié, hauteur de sol introuvable, ou « la copie n'a pas atterri » avec les deux lectures du Bedrock. `/dbg level` affiche les mêmes faits, prêts pour une capture d'écran.

C'est la réponse à un vrai rapport de bug : « The room could not be built » ne disait ni ce qui avait été lu, ni si le chunk était chargé, ni si une salle était déjà là. Un moteur qui ne devine pas doit au moins dire ce qu'il a vu.

**Un palier de difficulté doit être construit dans la salle.** Le code ne pose aucune plaque : il lit le bloc sous le joueur (`onBlockStandStart` → `difficultyForPadBlock`) et téléporte. Une salle qui ne contient pas de Concrete du niveau suivant est un cul-de-sac, et c'est le seul contenu qu'une salle doit fournir en plus de sa géométrie.

## 11. Tests

`npm test` — 71 tests.

- `tests/dungeon/config.test.js` — une difficulté est un ordre et ne porte **aucune** hauteur ; la plage verticale tirée commence au-dessus de `y = 0` et couvre bien 1 000 à 100 000 blocs ; un pad = une difficulté ; Hell est le dernier ; le tirage de salle est stable et étalé ; les huit niveaux tirent dans la même liste ; les salles d'un niveau passent avant les communes ; une salle malformée est ignorée sans casser le niveau ; **la conversion chunk → bloc, y compris sur les coordonnées négatives** ; les 15 salles livrées occupent 15 chunks distincts ; une salle ne porte aucune propriété.
- `tests/dungeon/loader.test.js` — un état par entrée : chaque entrée tire sa propre place dans le carré configuré, deux entrées vivantes restent à `spawnSeparation` l'une de l'autre, une place n'est tirée qu'une fois, `newOrigin` en donne une autre, un départ la rend et ne laisse rien en mémoire, deux joueurs de la même difficulté ne partagent ni place ni plan ; et un faux serveur où **`copyChunk` depuis un chunk non chargé ne fait rien**, où une copie dans un chunk non envoyé est ignorée, et où **un `getBlock` de chunk non envoyé déclenche l'envoi, deux ticks plus tard** : une salle est une seule copie, la sonde distingue « pas envoyé » / « vide » / « salle déjà là », **et seul le Bedrock compte** : du terrain ordinaire à la même profondeur ne passe pas pour une salle, une salle du redémarrage précédent n'est pas recopiée, une copie est confirmée au tick suivant et jamais dans le sien, la file est bornée, une salle illisible est désactivée puis retirée de la file, **aucun bloc n'est écrit nulle part**, la hauteur de sol est lue et non configurée, un niveau vide ne coûte rien.
- `tests/world-code.test.js` — le bundle réel, dans un contexte `vm`, sur un faux serveur qui compte chaque `setBlock` comme une violation : compte à rebours, entrée, atterrissage sur le sol, gravité coupée puis rendue, une plaque Concrete construite dans la salle qui mène au niveau suivant, ordre des copies, joueur qui tombe et qui est reposé, aucun bloc écrit par le code, `/dbg level` qui dit pourquoi une entrée a échoué, commandes `/dbg`.

Ce qui n'est **pas** testé, faute de pouvoir l'être hors du jeu : le délai exact au bout duquel un chunk lu devient écrivable — `chunkLoadTicks: 2` vient de la mesure faite **en jeu** par le propriétaire du projet, pas d'une simulation. Le coût d'une copie, lui, est connu : moins d'un tick.

## 12. Références Bloxd vérifiées

| Fonction | Signature documentée | Usage |
| --- | --- | --- |
| `api.copyChunk` | `copyChunk(fromPos, toPos)` — « Does nothing if the source chunk is not loaded » | la génération entière |
| `api.getBlock` | `getBlock(x, y, z)` → `BlockName`, `null` hors chunk chargé — **et la lecture demande le chunk** | sonde de chargement, record de salle, sol des modèles |
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
