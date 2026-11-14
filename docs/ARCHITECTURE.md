# Architecture — génération par copies de chunks

**Statut : livré.** 4 modules, 97 tests verts, bundle de 27 k caractères sur les 512 k autorisés.

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
6. **Un tick plus tard, l'atterrissage est lu dans la salle copiée** — pas dans le modèle — et le joueur y est posé. Puis le bloc sous ses pieds est relu. S'il est là, c'est fini ; sinon la copie est retentée, `entryMaxTicks: 4` fois au total, puis le joueur est renvoyé au lobby avec la raison.

**L'atterrissage est lu dans la salle copiée, et nulle part ailleurs.** Trois bugs ont vécu ici, et ils expliquent tous un joueur dans le sol :

- la hauteur venait du **premier modèle de la liste**, alors que `templateFor` tire une salle par chunk : l'entrée prend souvent une autre salle, avec un sol à une autre hauteur ;
- la colonne était lue **dans le modèle**, puis la hauteur recalculée comme « bas de couche + nombre de cases ». C'est juste tant que le modèle est construit sur la grille que la table annonce — et faux dès qu'une coordonnée de chunk est mal saisie, ce qui est la seule chose qu'un humain peut rater en construisant une salle ;
- le calcul avait lieu **avant la copie**, et la vérification qui suivait relisait le bloc sous la position calculée : une hauteur fausse était donc vérifiée contre elle-même, et le joueur se posait dans le sol sans message.

Maintenant l'ordre est : **copier, puis lire**. `landingPosition` lit la colonne de la salle dans **le chunk de destination** (`origin.x, origin.y, origin.z`) — la copie conserve la disposition locale, donc c'est le bloc que le joueur aura sous les pieds — et la hauteur est la coordonnée absolue de ce bloc, jamais une addition. La vérification qui suit relit le bloc sous la position que le serveur a acceptée (`getPosition`), et le joueur reçoit `Landed at y … · floor block at y …` : deux nombres à recopier dans un rapport de bug.

**La position est ensuite testée là où le joueur sera**, et c'est ce qui remplace toute théorie sur la hauteur. Le propriétaire du projet a décrit la recherche, et elle est implémentée telle quelle :

1. la colonne est tirée au hasard dans `landingMargin = 4` cellules — jamais contre les murs ;
2. le moteur teste la case du milieu, puis **le tour** (les 8 cases autour), en demandant au monde si la case **et celle au-dessus** sont de l'Air : ce sont les deux cases qu'occupe un joueur debout ;
3. si rien ne passe, la position monte de **+1** et la recherche recommence, `landingSearchLift: 2` fois ;
4. si tout est bloqué, une **autre colonne est tirée dans le même chunk** et la recherche repart, `landingSearchTries: 3` fois.

Si rien ne marche, `landingPosition` répond `null` et le joueur reçoit un message : il n'est jamais posé dans la pierre. La hauteur de départ est `spawnAboveFloor = 7`, la valeur mesurée en jeu (2 dans l'ancien moteur) plus les 5 blocs que le propriétaire a demandés — c'est un point de départ, la recherche corrige à partir de là.

Un joueur ne peut donc pas apparaître dans un mur, ni dans le sol, et deux joueurs ne se croisent plus du tout : chacun a son propre donjon (§5bis).

7. Les salles alentour sont mises en file, autour de l'origine de cette entrée.

Rien n'est annoncé avant que le sol existe, et aucune plaque n'est posée : celle qui mène au niveau suivant est dans la salle.

## 6ter. Les mobs : une série de salles à nettoyer

Un donjon n'est pas un décor : c'est une suite de salles à vider. La règle du propriétaire, et
la seule chose qui la rende sûre en mémoire :

| Moment | Ce qui se passe |
| --- | --- |
| le joueur entre dans une salle | les **quatre salles autour** (x±1, z±1) sont peuplées ; les **autres** perdent leurs mobs |
| le dernier mob d'une salle meurt | la salle est **clear** : `setBlockData` sur le bloc du coin (`mobClearCell`), et le joueur reçoit `CLEAR` |
| la salle du spawn | clear **avant** la première lecture, donc un run ne commence pas par un combat |
| le joueur quitte le donjon | ses mobs sont tués (`forgetMobs`), sinon ils survivraient au donjon |
| le joueur **meurt** | ses mobs sont tués et **les quatre salles autour de l'entrée sont repeuplées** ; le donjon, sa place, son Y et ses salles clear restent (`resetMobs`) |
| le joueur entre dans un niveau | l'ancien donjon est nettoyé avant `release`, et la téléportation d'arrivée n'est pas lue comme une entrée dans une salle (`justPlaced`) |

**Où vit le record, et pourquoi là.** `setBlockData(x, y, z, { clear: true })` stocke des données
**sur** un bloc existant — cela ne change pas le bloc, et c'est la seule écriture autorisée du
projet. Les données d'un bloc sont **effacées quand le bloc change**, donc le record est posé sur
une case d'air de la salle, au-dessus de son sol : le Bedrock sous une salle est justement la
case que chaque copie remplace. Et le record se lit dans le monde, pas dans notre mémoire : après
un redémarrage, ou un retour dans une salle nettoyée plus tôt, une seule lecture répond.

**Le Y est celui du joueur.** Sa position d'atterrissage (§6) est vérifiée une fois — sol lu,
case et case au-dessus libres. Toutes les salles d'un niveau sont la même copie au même
étage, donc cette hauteur est valide partout : elle est gardée (`spawnY`) et passée à chaque
spawn, et **aucun sol n'est recalculé**. Un joueur qui saute ou qui tombe ne la déplace pas.

**La bonne question n'est pas « est-ce de l'Air ».** `api.getBlockSolidity(x, y, z)` répond
« solide / traversable », ce qui compte les plantes correctement : le donjon en contient, et
on les traverse. Deux cases sont testées (celle du mob et celle au-dessus), et une case dont le
chunk n'est pas chargé compte comme solide — dans le doute, on ne spawn pas dans le vide.

**Une salle doit exister avant de recevoir des mobs.** Ni `getBlockSolidity` (vrai pour un chunk
non chargé) ni `getBlock` (« Air » aussi bien dans un chunk vide que dans l'air d'une salle) ne
répondent à cette question : c'est la sonde du loader qui répond, `planned.get(clé) === "placed"`.
Une salle dont les mobs seraient posés sur du vide est exactement le bug d'atterrissage de la PR #46.

**Bestiaire et difficulté : deux multiplicateurs qui se composent.** `MOB_ROSTER` (config) liste
les dix mobs dans l'ordre où les niveaux les débloquent (`from`), avec leurs propres facteurs
`health`/`damage`/`speed`. `mobRosterFor(difficulty)` rend tous les mobs dont le `from` est **au
niveau ou en dessous** : Very Easy tire un Zombie, Hell tire parmi les dix. Les stats finales sont
`type × niveau` — un Skeleton en Hell, c'est 0,7 × 5 de PV — et le produit est **arrondi à deux
décimales** avant d'être posé : à une décimale, 5 × (1,75 × 3) perdait son quart de point.

Le type est **tiré au hasard à chaque mob** (`spawnOneMob`), avec la liste parcourue en rotation
depuis le tirage : une espèce malchanceuse ne bloque pas de slot. Un type refusé par le jeu est
abandonné pour la session, mais **par niveau** (`refusedMobs` est indexé `type|niveau`) : un nom
que Hell refuse ne doit pas priver Very Easy de son seul mob. La distinction faite est entre une
**exception** (le nom n'existe pas : on l'abandonne tout de suite) et un `null` (qui veut aussi
dire « trop de mobs pour le nombre de joueurs » : on ne le condamne qu'après une salle entière où
un autre type a marché).
Les statistiques sont multipliées **à partir de ce que le jeu rapporte** (`getMobSetting(…, true)`) :
`maxHealth`, `initialHealth`, `attackDamage`, `baseRunningSpeed`, `baseWalkingSpeed`. La table
`MOB_TUNING` ne contient donc aucun nombre de PV, seulement des multiplicateurs.

**Asynchrone, le spawn.** `attemptSpawnMob` rend un `MobId` avant que le mob existe, et un
`setMobSetting` fait dans la même frame ne tient pas. Les statistiques passent par une file
(`pendingTuning`) vidée **au tick suivant** (`flushMobTuning`). Un mob que le jeu retire de
lui-même (`onMobDespawned`) est oublié sans rendre la salle clear : une salle n'est clear que
si le joueur l'a vidée.

## 6bis. Sortir : le spawn est une boutique, et le donjon s'arrête là

Le spawn normal du jeu est désactivé dans ce monde, et le propriétaire l'a confirmé : il n'y a
pas de sol, rien que de l'air. Le retour au spawn est donc une chose que le code doit fournir,
et c'est **un objet de boutique**.

- Une catégorie **`Utilities`**, un objet `Teleport to spawn`, image `Lime Concrete`, coût `0`,
  `canBuy: true`, bouton `Teleport`. Créé au chargement du World Code, et recréé dans
  `onPlayerJoin` — un objet créé quand personne n'est connecté n'est pas toujours proposé au
  premier arrivant, et recréer un objet existant le remplace (comportement documenté de
  `createShopItem`).
- `onPlayerBoughtShopItem` ne répond qu'à cette catégorie et à cet objet ; tout le reste est
  laissé au jeu.
- Le clic fait **deux choses, dans cet ordre** : `setPosition` vers `[10, 21, 10]`, puis
  `stopBuilding`.

**Pourquoi cet ordre, et pourquoi l'oubli est le vrai sujet.** Le tick ne parcourt que
`playerDungeons` : c'est ce dictionnaire qui dit « ce joueur a un donjon ». Le supprimer arrête
donc net le scan, la file, le plan et les copies de ce joueur, et `release` rend la place. Le
téléport passe en premier pour que le dernier enregistrement contienne encore l'origine du
donjon : un enregistrement qui contiendrait la position du lobby serait un tick de scan pointé
sur le spawn — exactement la fuite que ce bouton ferme.

**Et pendant les ticks de chargement de l'entrée ?** L'entrée est une chaîne de `scheduleTimeout`
(2 ticks, puis 1 tick, puis `entryMaxTicks`). Chaque étape commence par « ce joueur a-t-il encore
un donjon ? » et s'arrête sinon : un joueur qui clique sur la boutique au milieu de l'entrée est
laissé au spawn, sans copie et sans message de niveau.

Ce que la boutique **ne fait pas** : elle ne détruit rien dans le monde. Les salles restent où
elles sont, et c'est le jeu qui vide la carte quand le propriétaire active son réglage.

## 7. Ce qui est lu et écrit dans le monde, et pourquoi

| Opération | Quand | Ce qu'elle remplace |
| --- | --- | --- |
| `getBlock` sur le Bedrock d'un chunk | avant chaque copie, puis au tick suivant | « je suppose que le chunk est chargé », et « je suppose que la copie a réussi » |
| `getBlock(src)` sur un modèle | avant chaque copie | suppose que `copyChunk` lit un chunk chargé — faux, et silencieux |
| `getBlock` en colonne | une fois par entrée | une constante « hauteur du sol » fausse pour un modèle sur dix |
| `getBlockSolidity` | à chaque case de mob | « est-ce de l'Air » — les plantes du donjon sont traversables |
| `setBlockData` sur le coin d'une salle | quand une salle est vidée | un compteur en mémoire, qui ne survit pas à un redémarrage. **La seule écriture du projet** |

**Le moteur n'écrit jamais un bloc, nulle part.** C'est la contrainte que le propriétaire du projet a posée, et elle simplifie tout : aucune case d'une salle n'est réservée, aucun témoin, aucune plaque, aucune réparation. Les seules opérations autorisées dans un chunk sont `copyChunk` et des lectures — plus **une** exception, demandée explicitement : `setBlockData` sur le bloc du coin d'une salle, qui stocke des données *sur* un bloc existant sans le changer (voir §6ter).

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
| `level.mobs` | 4 salles au plus | une salle sort de la carte dès que le joueur la quitte |
| `level.populated` | une entrée par salle visitée | un donjon par entrée, détruit par `release` |
| `level.pendingTuning` | les mobs d'un tick | vidée au tick suivant |
| `level.refusedMobs` | au plus types × niveaux | une entrée par nom refusé, indexée `type|niveau` |
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

`npm test` — 97 tests.

- `tests/dungeon/config.test.js` — une difficulté est un ordre et ne porte **aucune** hauteur ; la plage verticale tirée commence au-dessus de `y = 0` et couvre bien 1 000 à 100 000 blocs ; un pad = une difficulté ; Hell est le dernier ; le tirage de salle est stable et étalé ; les huit niveaux tirent dans la même liste ; les salles d'un niveau passent avant les communes ; une salle malformée est ignorée sans casser le niveau ; **la conversion chunk → bloc, y compris sur les coordonnées négatives** ; les 15 salles livrées occupent 15 chunks distincts ; une salle ne porte aucune propriété.
- `tests/dungeon/loader.test.js` — un état par entrée : chaque entrée tire sa propre place dans le carré configuré, deux entrées vivantes restent à `spawnSeparation` l'une de l'autre, une place n'est tirée qu'une fois, `newOrigin` en donne une autre, un départ la rend et ne laisse rien en mémoire, deux joueurs de la même difficulté ne partagent ni place ni plan ; et un faux serveur où **`copyChunk` depuis un chunk non chargé ne fait rien**, où une copie dans un chunk non envoyé est ignorée, et où **un `getBlock` de chunk non envoyé déclenche l'envoi, deux ticks plus tard** : une salle est une seule copie, la sonde distingue « pas envoyé » / « vide » / « salle déjà là », **et seul le Bedrock compte** : du terrain ordinaire à la même profondeur ne passe pas pour une salle, une salle du redémarrage précédent n'est pas recopiée, une copie est confirmée au tick suivant et jamais dans le sien, la file est bornée, une salle illisible est désactivée puis retirée de la file, **aucun bloc n'est écrit nulle part**, la hauteur de sol est lue et non configurée, un niveau vide ne coûte rien.
- **mobs** (dans `loader.test.js`) — l'entrée dans une salle peuple les quatre salles autour et jamais celle du joueur ; les mobs sont au Y du joueur, jamais dans un bloc solide, jamais sur les plaques ; une case de plante reste utilisable (`getBlockSolidity`, pas « Air ») ; entrer dans une salle garde ses mobs et tue ceux des autres salles ; le dernier mob écrit le record du coin et le joueur reçoit `CLEAR` ; une salle clear n'est plus jamais peuplée ; un type refusé par le jeu ne casse pas le reste ; la difficulté multiplie les statistiques (Hell : 5 mobs à ×5 PV) ; un mob retiré par le jeu ne rend pas la salle clear ; une salle vidée puis regagnée ne se remplit pas. Et dans `world-code.test.js` : les mobs apparaissent autour de l'entrée, la salle d'entrée est écrite clear, `onPlayerKilledMob` dit `CLEAR` et écrit le record, revenir au spawn tue les mobs, **mourir garde le donjon (même origine, aucune copie) et le repeuple** — le tout sans écrire un bloc.
- **bestiaire** (dans `loader.test.js`) — chaque niveau tire parmi les mobs débloqués à son niveau ou en dessous ; les multiplicateurs du type se composent avec ceux du niveau (Hell : PV et dégâts vérifiés mob par mob, et la salle est bien mélangée) ; un type refusé par le jeu ne laisse pas la salle vide ; un refus est enregistré **pour son niveau** ; mourir vide les mobs sans oublier les salles, donc le donjon peut encore se remplir ; quitter l'oublie pour de bon.
- `tests/world-code.test.js` — la boutique `Utilities` (créée, gratuite, avec une image), un clic qui ramène au spawn **et** arrête le donjon — plus aucune salle n'est copiée ensuite et `/dbg` ne voit plus de donjon —, un clic pendant l'entrée qui abandonne l'entrée au lieu de reposer le joueur, et un achat d'autre chose qui ne fait rien ; le bundle réel, dans un contexte `vm`, sur un faux serveur qui compte chaque `setBlock` comme une violation : compte à rebours, entrée, atterrissage sur le sol, gravité coupée puis rendue, une plaque Concrete construite dans la salle qui mène au niveau suivant, ordre des copies, joueur qui tombe et qui est reposé, aucun bloc écrit par le code, `/dbg level` qui dit pourquoi une entrée a échoué, commandes `/dbg`.

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
| `onRespawnRequest` | `(playerId)` → `true \| void \| number[]` ; **une position** est la réponse à donner pour poser le joueur, `true` veut dire « je téléporte moi-même » | reposer le joueur à l'atterrissage d'entrée, vérifié à l'arrivée |
| `api.attemptSpawnMob` | `(mobType, x, y, z, opts)` → `MobId \| null`, **asynchrone** | les mobs des salles |
| `api.despawnMob` | `(mobId)` | quitter un donjon, quitter une salle |
| `api.setMobSetting` / `getMobSetting` | `(mobId, setting, value)` / `(mobId, setting, returnDefault)` | les multiplicateurs de difficulté, appliqués au tick suivant |
| `api.getBlockSolidity` | `(x, y, z)` → `boolean`, **vrai pour un chunk non chargé** | une case de mob est-elle traversable |
| `api.setBlockData` / `getBlockData` | `(x, y, z, data)` / `(x, y, z)` → `any`, **effacées quand le bloc change** | le record « clear » d'une salle |
| `onPlayerKilledMob` / `onMobDespawned` | `(playerId, mobId, damageDealt, withItem)` / `(mobId)` | le dernier mob d'une salle |

`getEmptyChunk` et `resetChunk` restent écartés : `resetChunk` n'existe pas dans l'API Reference, et `copyChunk` couvre le besoin avec une fonction documentée.

## 13. Feuille de route

- **Modèles.** Remplir `ROOM_TEMPLATES` (voir §5 de `README.md`), un jeu par difficulté, avec des portes alignées.
- **Variantes.** Le tirage est déjà déterministe par chunk : ajouter un modèle suffit à varier un niveau.
- **Pads dans le donjon.** Aujourd'hui le pad n'est écrit qu'à l'endroit où le joueur atterrit. Le poser aussi dans les salles suivantes revient à écrire 25 blocs par salle visitée — à décider quand le coût d'une copie sera mesuré en jeu.
- **Mobs : faits.** Ajouter un mob revient à une entrée dans `MOB_ROSTER` avec son niveau d'ouverture et ses multiplicateurs ; les noms non confirmés par la documentation se vérifient en jeu, `/dbg level` nommant tout nom refusé.
- **Butin, minerais.** Aucune de ces fonctionnalités ne dépend de la génération : la structure est un décor figé.
