# Phase 4 — construction physique

**Livré.** `builder.js`, `worldBuilder.js`, `service.js`, et le rebranchement de l'hôte (`src/worldCode.js`). Le moteur ne décide plus seulement : il pose des blocs. L'ancien générateur (`src/dungeon/generator.js`, 1 583 lignes) et ses deux fichiers de tests sont supprimés — c'est le remplacement, pas une cohabitation. `npm test` : **162 tests verts**.

## Les trois couches

```
src/dungeon/builder.js       planifie les blocs d'une salle, ne touche à rien
src/dungeon/worldBuilder.js  seul fichier qui lit et écrit le monde
src/dungeon/service.js       un donjon par difficulté, séquence de spawn, pads
src/worldCode.js             le lobby appelle le service ; il ne génère plus rien
```

Cette séparation n'est pas décorative : `builder.js` est testé dans Node contre un écrivain en mémoire, `worldBuilder.js` contre un faux serveur qui **refuse** les écritures hors chunk chargé, et `service.js` contre un faux `api` qui n'expose une cellule qu'une fois le joueur téléporté. Les trois bugs d'intégration ci-dessous ont tous été trouvés par ces faux, jamais par lecture.

## L'ordre imposé, et pourquoi il est imposé

| Phase | Écrit | Raison |
| --- | --- | --- |
| 1 | `Air` **au-dessus du plafond** (niveaux `wallHeight+2` à `+4`), **seulement si la lecture de quatre cellules y trouve de la roche** | idempotence d'une reconstruction, sans payer un déblaiement sur un donjon neuf |
| 2 | sol, toutes les cellules de la forme, pierre tirée une par une | on marche avant d'avoir des murs |
| 3 | murs, linteau compris, cellules de passage sautées jusqu'à `passageHeight` | le mur n'est jamais plein puis percé, et le linteau n'est pas une phase séparée |
| 4 | plafond, cellules de passage sautées | ferme le volume sans bloquer |
| 5 | pad de difficulté, sur une cellule de sol connue | dernier, pour ne jamais retarder une salle marchable |

## Les passages — ce qui manquait

Le constructeur ne posait que les cellules des salles. Les connexions du graphe stockaient bien leurs cellules (`joint` pour le joint minimal, `bridge` pour un couloir plus long), mais **personne ne les construisait** : chaque porte s'ouvrait sur trois cellules de vide, et le donjon n'avait aucun passage. Mesuré sur un donjon de 24 connexions : 72 cellules de joint, **0 écrite**.

Un passage est maintenant un couloir, pas un trou :

| Couche | Ce qui est écrit |
| --- | --- |
| sol | la cellule du passage, pour avoir où marcher |
| flancs | les cellules voisines qui n'appartiennent à aucun autre passage, sur toute la hauteur des murs |
| plafond | au-dessus du passage **et** des flancs, pour que ce soit un tunnel et pas une tranchée |
| zéro | les niveaux 1 à `passageHeight` de la cellule marchable : écrire là mure la porte |

Trois règles font que cela tient :

1. **aucune cellule d'une salle n'est touchée** — la salle construit son propre sol et ses propres murs ;
2. **le volume marchable est activement nettoyé** avant d'être bâti, parce que deux tunnels peuvent se croiser et que le premier murait la cellule que le second revendique ;
3. **chaque porte connectée est rouverte** après la fin de la salle et après la construction du passage. Un plan de salle est figé au premier lot : si la porte était encore `pending` à ce moment, elle est murée dans ce plan, et rien d'autre n'enlèverait ce mur.

## Le vrai coupable en amont : une porte qui donne sur un mur

Le générateur autorisait une ouverture dont la « cellule d'approche » était un **pilier**. Le constructeur mure toute cellule qui touche un vide sur un axe ; une cellule d'approche encadrée par deux vides est donc un mur avec un trou dedans — on traverse la porte et on tape dans la brique. `planOpenings` compte maintenant ces vides et refuse l'ouverture (au plus **1** vide latéral, la valeur d'un angle). Effet secondaire vérifié : aucune forme générée ne perd ses ouvertures (0/200 contre 21/200 avec un critère naïf de dégagement).

## La file de construction

Deux défauts de la file expliquaient des passages manquants :

- une entrée de passage dont le chunk n'était pas chargé était **jetée** ; elle est désormais réenfilée ;
- le cycle s'arrêtait à la première salle inachevée, donc **une seule salle avançait par cycle** et tout ce qui était derrière attendait indéfiniment. Les entrées inachevées retournent à la fin de la file et le cycle continue.

Les passages comptent aussi dans le budget de blocs du tick : sans cela, un cycle qui servait tous les seuils d'un coup écrivait 879 blocs.

## Mesure de sortie

Quatre donjons, faux serveur, joueur immobile dans l'entrée, **à l'échelle ×5** :

| Donjon | Difficulté | Salles | Plus grande | Connexions | Passages | Atteignables à pied | Écritures perdues | Audits / échecs | Tous bâtis | Blocs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| alpha | Very Easy | 28 | 55 blocs | 27 | 27 | **28 / 28** | 0 | 28 / 0 | 124 (6,2 s) | 183 333 |
| beta | Easy | 33 | 55 blocs | 35 | 35 | **33 / 33** | 0 | 33 / 0 | 140 (7,0 s) | 223 219 |
| gamma | Medium | 36 | 52 blocs | 37 | 37 | **36 / 36** | 0 | 36 / 0 | 142 (7,1 s) | 245 055 |
| delta | Normal | 35 | 55 blocs | 38 | 38 | **35 / 35** | 0 | 35 / 0 | 151 (7,5 s) | 240 768 |

Le BFS part de la cellule d'entrée, ne marche que sur des cellules de sol non recouvertes, et ignore l'`Air`. Un donjon de 33 salles pèse ici 223 000 blocs — l'équivalent de seize donjons de ×1.

Le test d'intégration `tests/engine/service.test.js` fait exactement cela sur la difficulté Easy : il part de l'entrée, marche de cellule en cellule au niveau du sol, échoue si une salle construite n'est pas atteignable, et vérifie en plus que **chaque connexion a son passage construit** (`stats.passages === connections.length`).

**Texture.** Chaque bloc structurel est tiré **un par un** dans `"Stone"`, `"Messy Stone"`, `"Smooth Stone"`, `"Stone Bricks"`, `"Cracked Stone Bricks"`, `"Mossy Stone Bricks"`. Sol : famille des briques ; plafond : `Smooth Stone` ; murs et linteaux : la palette entière. Le tirage est un hachage de `(graine de salle, cellule, niveau)`, donc :
- une salle interrompue puis reprise a les mêmes pierres qu'une salle construite d'un trait ;
- une salle reconstruite depuis sa graine est identique ;
- deux salles voisines ne se ressemblent pas.

Cela interdit `setBlockRect` pour la structure — un rectangle est uniforme, et il est **plafonné à 360 blocs par appel**, avec **exactement trois arguments** : `setBlockRect([x,y,z],[x1,y1,z1], "Air")`.

La décision de conception qui compte : **aucune cellule n'est écrite deux fois**. La passe `clear` de la proposition initiale vidait le volume du sol au plafond, puis la passe `floor` réécrivait le sol — la même cellule, deux valeurs, donc un monde qui dépend du découpage en lots. Elle est limitée aux niveaux au-dessus du plafond, et un test l'assure : 0 doublon sur toutes les salles d'un donjon.

Une ouverture `pending` (qui ne mène nulle part) est **murée** : c'est un cul-de-sac, pas un trou dans le vide. Seules les ouvertures `connected` percent un passage. Corollaire vérifié : le pad n'est jamais posé sur une cellule de passage, sinon traverser une porte téléporterait.

## Reprise et vérification

`writeRoom` renvoie un curseur et refuse de repartir de zéro sans lui (`room r1.2 is half built: an explicit cursor is required to resume it`). Ce refus est volontaire : la version implicite réécrivait des blocs et renvoyait quand même `done`.

Le pont vérifie ce qu'il a écrit par `getBlock` — les pads et les passages toujours, le reste un bloc sur huit — répare **une fois**, relit ce qu'il vient de réparer, puis déclare la salle `failed` si elle reste fausse. Une salle fausse déclarée `built` est le pire des états : le joueur tombe dedans et rien ne le signale.

Cette vérification ne se fait plus **dans** le chemin de construction : terminé, un lot de blocs met la salle en file d'audit (`auditQueue`), et `auditNext` en traite **une par tick**, hors du budget d'écriture. Lire quarante cellules dans le même tick que l'écriture de huit cents blocs, c'était payer deux fois dans le même tick et retarder le monde. `worldBuilder.asControllerBuilder().auditRoom(manager)` est le point d'entrée que le contrôleur appelle avant de construire, pour qu'un tick à court de budget n'affame pas l'audit.

Rien n'est écrit avant que la zone soit chargée. Le pont sonde `getBlock` sur quatre cellules de la salle ; un `null` vaut « chunk absent », une exception aussi. Ce n'est pas de la prudence gratuite : sur un faux serveur, dix cellules écrites à `y = NaN` avaient été acceptées sans le moindre message.

## La séquence de spawn

```
1. getBlock sur la cellule d'atterrissage        (crée le chunk, ne rien écrire)
2. setPosition au milieu de la cellule (x.5/z.5), y = floorY + 2
3. chunkWarmupTicks (3) ticks                    (le client charge)
4. layLandingPad : 5×5 de Stone Bricks
5. buildEntrance par lots de 80 blocs
6. onReady — et seulement là, le joueur entre dans le donjon
```

Mesuré sur un faux serveur **à l'échelle ×5** : entrée prête au tick **10** (0,5 s), **5 351 blocs** écrits (dont les **441** du pad de 21×21 à l'atterrissage, puis la salle par lots), **0 écriture perdue**, jamais plus de **720** blocs dans un tick — c'est la taille du lot, et c'est elle qui borne un tick à l'entrée, pas le budget. Le pad suit l'échelle (5×5 → 21×21) : un îlot de 5 blocs au milieu d'une salle de 55 se lit comme une erreur de placement. Il a d'ailleurs fallu une correction pour que ce soit vrai : le service passait encore un rayon de 2 en dur, ce qui laissait le pad à 5×5 pendant que les salles passaient à 55 — le rayon est désormais celui de `layLandingPad`, dérivé de `scale`. Le sol de la cellule d'atterrissage est relu en `Stone Bricks` au moment exact de `onReady` : rien n'est annoncé avant que le sol existe.

**Aucune protection de bloc n'est posée.** Le monde tourne en `survivalAdventure` : un joueur ne peut rien casser, donc verrouiller la coque serait un appel qui coûte et n'achète rien. Le seul sens utile de l'API est l'inverse — autoriser la casse — et il s'écrit **par type de bloc** (`setCanChangeType`), jamais par rectangle : un minerai est cassable, la pierre autour ne l'est pas, et les deux partagent la même colonne. `worldBuilder.allowMining()` existe déjà et ne fait aucun appel tant que `DUNGEON_CONFIG.breakableBlocks` est vide — c'est-à-dire aujourd'hui.

## Un donjon par difficulté

Clé `${lobbyName}|${difficultyId}`, graine dérivée des deux par FNV-1a — **jamais de l'horloge**. Deux joueurs de la même difficulté partagent les mêmes murs ; un redémarrage reconstruit exactement ce que les joueurs ont vu.

Les pads suivent la table des difficultés : Ultra Insane mène à Hell, et Hell répond « This is as far as the dungeon goes. » plutôt que de téléporter dans le vide.

## Bugs trouvés en écrivant cette phase

Quatre défauts réels, tous invisibles à la lecture et tous attrapés par un faux serveur :

1. **Les salles restaient à moitié construites.** Le pont ne renvoyait qu'un nombre de blocs ; le contrôleur en concluait « fini » au premier lot de 80 et ne reprenait jamais. Mesuré : 33 salles générées, 1 seule finie, **1 957 cellules de sol non posées sur 2 047**. Corrigé en faisant voyager `done` avec le coût, et en réenfilant une salle non finie.
2. **`locatePlayerRoom` plantait pour tout joueur.** Un joueur est au milieu d'une cellule (`x.5`) ; la fonction indexait le masque avec cette fraction et levait un `TypeError`. Aucun test ne la couvrait avec une position réelle, seulement avec des coordonnées entières de laboratoire.
3. **Le service passait `{ x, y }` là où le contrôleur attend `{ x, z }`.** Résultat : `roomId: null` pour tout le monde, découverte muette, donjon qui ne pousse jamais.
4. **Un joueur parti continuait d'alimenter son contrôleur** : le donjon générait autour d'un fantôme. `leave()` délie maintenant le joueur, et un donjon vide ne génère plus rien.

## Mesures

Deux séries, avant et après l'optimisation de vitesse (même faux serveur, même graine, donjon Hell, **échelle ×1**) :

| Mesure | Avant | Après |
| --- | --- | --- |
| ticks avant la dernière salle | 439 | **53** |
| temps avant la dernière salle | 21,9 s | **2,65 s** |
| blocs écrits | 14 512 | **9 132** |
| écritures perdues (chunk non chargé) | **0** | **0** |
| cellules de sol non posées | **0** sur 2 047 | **0** |
| salles `built` | 34 / 34 | 34 / 34 |
| salles auditées / échecs / réparations | — | 34 / **0** / **0** |
| génération cumulée | 125 ms | 118 ms |
| construction cumulée | 42 ms | **0,8 ms** de planification |

Le coût par tick est désormais dominé par la génération, comme en Phase 3 ; la construction ne pèse plus rien au regard du reste, parce qu'elle n'a plus de temps d'attente.

## La vitesse : où passaient les 21,9 secondes

> Les chiffres de cette section sont ceux de l'échelle ×1, celle sur laquelle l'optimisation a été faite et mesurée. Ils restent valables en proportion : le budget par tick et le nombre de blocs par salle ont été multipliés avec le donjon (§ « Changement d'échelle »), pas la logique.

La première version mettait **21,9 s** à bâtir un donjon Hell complet (34 salles, 439 ticks) alors que le CPU ne coûtait presque rien : `buildMs` cumulé sur tout le donjon, 60 ms ; `generateMs`, 113 ms. Le temps n'était donc pas dans le travail, il était dans **la cadence** — et dans des blocs écrits pour rien.

Mesure de la répartition, sur 34 salles et 14 671 blocs écrits :

| Poste | Blocs | Part |
| --- | --- | --- |
| déblaiement (`Air`) | 5 631 | 38,4 % |
| murs | 4 304 | 29,3 % |
| plafond | 2 124 | 14,5 % |
| sol | 1 877 | 12,8 % |
| passages | 735 | 5,0 % |

**41 % des écritures étaient de l'`Air`**, et la médiane était de 5 lots de 80 blocs par salle — donc cinq ticks de latence par salle, pour 359 blocs. Quatre leviers, tous mesurés :

| Levier | Ce qui change | Effet |
| --- | --- | --- |
| 1. construire **hors** du cycle | `tick()` appelle `buildStep()` à chaque tick ; `cycle()` ne fait plus que découvrir et générer | le monde n'attend plus l'horloge du graphe : 22 ticks avec écriture sur 434 deviennent la quasi-totalité |
| 2. cadence du graphe | `cycleTicks` 20 → **10** (une demi-seconde) | génération moyenne 4,40 ms → 1,47 ms par cycle ; dernier bloc à 5,10 s → **2,10 s** à lui seul |
| 3. déblaiement conditionnel | `roomBlocks(..., { clearAbove })` : quatre `getBlock` au-dessus de la salle décident si la passe `Air` sert à quelque chose | 5 631 blocs de `Air` → **0** sur un donjon neuf |
| 4. lots qui suivent le budget | `blocksPerBatch` 80 → **240** (le budget est de 800 : un lot était cinq fois trop petit) | médiane 5 lots par salle → 2 ; 178 passes pour tout le donjon → 34 |

Effet cumulé, même faux serveur, même graine :

| Métrique | Avant | Après |
| --- | --- | --- |
| dernière salle bâtie | tick 439 = **21,9 s** | tick **53 = 2,65 s** |
| blocs écrits | 14 512 | **9 132** |
| déblaiement `Air` | 5 631 blocs | **0** sur donjon neuf |
| lots par salle (médiane) | 5 | ~1,5 |
| vérification | dans le cycle chaud | **1 salle par tick**, hors budget |
| écritures perdues | 0 | **0** |
| salles auditées / échecs | 34 / 0 | **34 / 0** |

Soit **×8,3** sur le temps d'apparition du donjon, sans écrire un bloc de plus que nécessaire. Ce qui n'a **pas** été fait, volontairement : passer `cycleTicks` à 5 (mesuré à 1,50 s, mais la génération moyenne tombe à 0,65 ms et le pire cas à 11,5 ms — la marge entre le pire cycle et la demi-seconde de budget devient trop mince pour une machine chargée), et regrouper les écritures en `setBlockRect` (un rectangle est uniforme : il détruit la texture, et il est plafonné à 360 blocs par appel).

Un détail qui compte pour la suite : `cycle()` **ne construit plus**. Tout test qui veut des écritures de bloc doit appeler `controller.cycle()` d'abord (pour remplir la file) puis laisser tourner les ticks. Le contrat est plus net ainsi — le graphe décide, le tick écrit — mais il se paie d'un piège : un `buildStep()` seul, sans cycle préalable, ne trouve rien à construire.

## Changement d'échelle : ×5, et ce que le ×5 a révélé

Le donjon est passé de salles de 4 à 11 cellules et de couloirs d'une cellule à des salles de 20 à 55 et des couloirs de 5. Les valeurs multipliées sont des **multiples exacts** des anciennes (4 × 5 = 20, 11 × 5 = 55), pour que ce soit le même donjon cinq fois plus grand, et pas un autre donjon.

| Paramètre | ×1 | ×5 | Pourquoi |
| --- | --- | --- | --- |
| `minWidth` / `maxWidth` | 4 / 11 | **16 / 55** | l'enveloppe des salles ; les tailles se tirent dans une échelle de paliers (`sizeBands`) |
| `minDepth` / `maxDepth` | 4 / 11 | **16 / 55** | idem |
| `wallHeight` | 4 | **5** | non multiplié : la hauteur n'est pas ce qui fait une grande salle, et 16 blocs coûtaient 4 000 blocs de mur par salle |
| `wallGap` | 3 | **15** | la maçonnerie entre deux salles suit |
| `minPassageWidth` / `maxPassageWidth` | 1 / 1 | **5 / 5** | « taille des couloirs » |
| `passageHeight` | 1 | **4** | calé sur `wallHeight` (4 sur 5), pas sur l'échelle : la porte arrive à un bloc du plafond |
| `minCornerClearance` | 1 | **5** | une porte ne colle plus au coin |
| `minOpeningSpacing` | 2 | **10** | deux portes d'une même face |
| `cellsPerOpening` | 6 | **30** | la densité de portes, pas leur nombre |
| `maxBridgeLength` | 4 | **20** | un pont est un couloir |
| `worldMargin` | 8 | **40** | marge autour du donjon |
| `discoveryDistance` / `crossingDistance` | 30 / 6 | **150 / 30** | mesurés depuis la porte, donc en blocs |
| `activeRoomDistance` / `suspendDistance` | 48 / 96 | **240 / 480** | idem |
| `maxDungeonRadius` | 512 | **2560** | vingt-cinq fois la surface, cinq fois le rayon |
| `maxRadius` par difficulté | 96…384 | **480…1920** | idem |
| `maxBlocksPerTick` | 800 | **2400** | une salle pèse ~25× plus de blocs |
| `blocksPerBatch` | 240 | **720** | suit le budget |
| `REGION_SIZE` (index) | 16 | **80** | une région contient toujours une salle |

Une valeur nouvelle apparaît avec cette échelle : **`minConnectionOverlap` (3)**, le nombre de cellules que deux fentes de porte doivent partager pour que la connexion existe (voir plus bas).

**Ce qui n'a volontairement pas été multiplié**, et pourquoi :

- **La hauteur, elle, ne suit pas l'échelle : `wallHeight` vaut 5, pas 20.** Une salle de 55 cellules sous 16 blocs de plafond se lit comme une cathédrale, coûte des milliers de blocs de mur de plus, et ne paraît pas plus grande — c'est la surface au sol qui fait la taille. Cinq blocs, c'est trois au-dessus des yeux.
- **`passageHeight` vaut 4 et non 5.** Il est calé sur le mur (4 sur 5), pas sur l'échelle : à 5 la porte égalerait la hauteur du mur, soit un plafond ouvert au-dessus de chaque porte.
- **`minOpenings` / `maxOpenings` restent 2 / 5.** Ce sont des **nombres**, pas des longueurs : une salle garde deux à cinq portes, sinon chaque salle devient un carrefour.
- **`minApproachDepth` reste 1**, et c'est le seul chiffre pour lequel la montée d'échelle **casse** le moteur : la règle est `clearance > minApproachDepth`, donc 1 exige un dégagement de 2 et 3 exigerait un dégagement de 4. À 4, plus aucune forme ne peut héberger une porte — l'entrée elle-même échoue, six fois sur six (`ROOM_DISCONNECTED`, mesuré au ×3). Le dégagement 2 est une cellule avec au plus deux voisins vides, et `faceRuns` refuse déjà les deux vides derrière une porte : la porte n'est jamais plus étroite que le mur qu'elle perce, à n'importe quelle échelle.
- **`anticipationDepth` (3), `priorityDepthWeight` (40), `backlogThreshold` (60)** sont des profondeurs et des poids, pas des distances.
- **`chunkSize` (32)** est une propriété du serveur, pas du donjon.

### Trois défauts que seul le passage à ×5 a rendus visibles

1. **Les couloirs n'étaient pas trop étroits : ils étaient décalés.** `jointCells`, `bridgeCells` et `passageCells` partaient de `centerX`/`centerY` en croyant lire le début de la fente. Une ouverture porte deux choses qui se ressemblent : sa **fente** le long du mur (`offsetStart`…`offsetEnd`) et son **centre** — qui est sa cellule du milieu sur l'axe du mur, et le mur lui-même sur l'autre axe. Lire les deux coordonnées dans la même paire est juste sur un axe et faux sur l'autre. Mesuré sur un donjon réel, face est, porte de 3 en offsets 6..8 : porte en colonne 13, couloir en 14..22, donc décalé d'une cellule. Un joueur traversait une ouverture de trois blocs et trouvait un boyau d'un bloc sur le côté. **Invisible à ×1** : une porte d'une cellule n'a aucune différence entre son centre et son début. Le correctif introduit `openingSpan` (la fente en coordonnées de salle) et `doorwayStart` (la même en monde, avec la coordonnée qui *traverse* le mur séparée de celle qui le longe).

2. **Deux portes larges ne se connectaient presque jamais.** La connexion exigeait des centres **exactement** alignés — un hasard qu'une porte d'une cellule satisfait par construction et qu'une porte de cinq presque jamais. Effet mesuré à ×5 : le réseau ne fermait plus aucune boucle et les ponts avaient disparu. Désormais deux portes se connectent dès que leurs fentes se **recouvrent** d'au moins `minConnectionOverlap` (3) cellules, et les deux portes sont **rétrécies** aux cellules partagées : le couloir est exactement aussi large que le trou qu'il relie, et aucune porte ne garde une partie de sa fente devant de la maçonnerie. L'index d'ouvertures cherche le partenaire sur toute la rangée d'en face, au lieu d'une seule cellule.

3. **Le contrôle d'aire chargée ne regardait que le milieu d'une salle.** Quatre sondes réparties en ordre de lecture tombaient toutes dans le même coin d'une salle de 55 blocs, et le constructeur écrivait dans un chunk non chargé — où le serveur perd le bloc **sans erreur**. Les sondes sont les quatre coins de la boîte englobante.

### Quatre défauts de plus, révélés par un joueur : « les couloirs dépassent et bloquent une partie de l'entrée »

Le défaut décrit en jeu — « parfois, les emboîtements avec les couloirs sont bizarres, ils dépassent et bloquent une partie de l'entrée » — n'était pas un défaut d'emboîtement : c'était **quatre** défauts qui se ressemblaient tous, et dont trois ne se voyaient qu'au niveau des blocs.

1. **Un couloir pouvait être plus large que la porte qui le précède.** Le pont était taillé d'après les fentes des deux portes *avant* que celles-ci soient rétrécies aux cellules qu'elles partagent : une porte de 4 recevait un couloir de 5, dont une cellule mordait le mur et sortait de la salle. Mesuré sur 1 200 salles / 1 184 connexions : **2 couloirs** dans ce cas, soit 0,17 %. C'est peu, c'est très visible, et un joueur en voit un.
   Le correctif est structurel : `planConnection` calcule **tout** — la fente partagée, la largeur, la rectitude, la continuité — *avant* que quoi que ce soit ne soit modifié, et `commitIfValid` ne rétrécit qu'ensuite. Un refus ne laisse plus de porte rétrécie sans connexion derrière (c'était le cas avant : le rétrécissement était fait avant `passageIsWalkable`).

2. **Un couloir pouvait traverser une troisième salle.** Une salle posée sur le flanc d'un couloir déjà committé le murait : les deux salles qu'il reliait devenaient inaccessibles, et **rien ne le relisait**. Mesuré sur 750 salles : **3 couloirs sur 738** traversaient une troisième salle, et coupaient deux salles. Mesuré avec l'échelle de tailles plus large : **60 salles sur 750** coupées du donjon.
   Le correctif : le manager tient l'ensemble des **cellules de couloir déjà committées**, et le validateur refuse tout candidat qui en couvre une (`CORRIDOR_BLOCKED`). La règle est volontairement étroite — seuls les couloirs committés sont protégés. Une porte *libre* qui regarde une salle voisine n'est pas un conflit : le constructeur mure une porte qui ne mène nulle part, ça coûte une porte et rien d'autre. Refuser ces portes-là a coûté un tiers des boucles (mesuré : 2 boucles au lieu de 6), parce qu'une grande salle posée contre une autre en regarde toujours quelques-unes.

3. **Le pad d'atterrissage ne suivait pas le plafond et sortait des murs.** Le service passait un rayon de 2 en dur (`5×5`) alors que les salles font jusqu'à 55 : un îlot ridicule au milieu d'une halle, et sur une entrée en croix — le centre du milieu d'une croix est de la roche — un pad de 21×21 écrit **à travers les murs**, dans le joint et devant la porte. Le pad est maintenant découpé sur l'empreinte de la salle, et la cellule d'atterrissage est choisie **au plus près du milieu** de la salle, à distance du rayon du pad, jamais sur une porte ni à côté.

4. **Un test comparait les mauvaises choses.** `bridgeCells only spans a bounded straight gap and never overlaps a room` construisait une paire dont les fentes ne se recouvraient pas (1 contre 5) : il passait avant que la connexion par recouvrement n'existe, et il ne testait donc pas ce qu'il annonçait.

Mesure après les quatre correctifs, sur 1 200 salles / 1 184 connexions et sur 750 salles :

| Défaut | Avant | Après |
| --- | --- | --- |
| couloir plus large que sa porte | 2 / 1 184 | **0** |
| couloir traversant une 3ᵉ salle | 80 / 1 177 | **0** |
| salles coupées du donjon (750 salles) | 61 | **0** |
| pad hors de sa salle | mesuré | **0** (découpé sur l'empreinte) |

Et deux tests le verrouillent : « every corridor is one straight run, exactly as wide as both its doorways » (rectitude, largeur, continuité, contact avec les deux murs) et « no corridor is ever built through a third room ».

### Les tailles de salles : une échelle de paliers, pas un tirage uniforme

« La taille des salles plus aléatoire » ne s'obtient pas en élargissant la plage : un tirage uniforme sur `[16, 55]` donne à chaque largeur la même chance, et le donjon se remplit de salles moyennes qui se ressemblent toutes. Mesuré sur 280 salles, la médiane était 36 et une largeur précise sortait 20 fois.

Les dimensions se tirent maintenant dans une **échelle de paliers** (`sizeBands`), avec deux axes tirés indépendamment :

| Palier | Poids | Ce que le joueur rencontre |
| --- | --- | --- |
| 16–18 | 4 | un cagibi : quatre à six pas de large, et il tient entre deux salles |
| 19–24 | 3 | une petite chambre |
| 26–34 | 2 | la salle ordinaire du donjon |
| 36–46 | 2 | une halle |
| 48–55 | 3 | la grande halle |
| 16–55 | 2 | l'exception : un boyau, ou un carré qui n'a pas d'équivalent ailleurs |

Le résultat sur 1 200 formes : `q90 / q10` des surfaces **7,6** contre **4,2** pour un tirage uniforme, 34 % de salles sous 700 cellules et 16 % au-dessus de 2 200. Sur 8 donjons réels de 35 salles, le coefficient de variation des surfaces passe de ~0,45 à ~0,59.

**Ce qui garantit qu'elles s'emboîtent toujours** : chaque palier est plus large que ce qu'une porte exige. La règle est `largeur de passage + 2 × dégagement de coin` de mur continu, soit 15 cellules à ×5, et le palier le plus étroit tire 16. Le tirage est donc libre par construction, et un test le vérifie palier par palier plutôt que sur un tirage chanceux. 0 forme sans porte sur 1 200.

### Deux corrections structurelles, du même passage

- **`passageIsWalkable` existait, était testé, et n'était jamais appelé.** Il l'est maintenant au moment de committer une connexion : une porte qui ouvre sur un mur ne peut plus être enregistrée. Mesuré sur 95 connexions : il n'en refuse aucune, ce qui est précisément pourquoi il ne coûte rien.
- **Un passage était écrit d'un seul tenant, hors budget.** À ×5, un joint de 15 cellules sur 5 de large avec toit et flancs fait environ 4 000 blocs dans un tick. Il est découpé en lots avec un curseur, comme les salles, et ses deux portes ne s'ouvrent qu'à la fin : un demi-couloir qui ouvre sur un trou est pire qu'un couloir en attente.
- **Le pad d'atterrissage ne suivait plus l'échelle.** Le service passait un rayon de 2 en dur à `layLandingPad`, ce qui avait été juste à ×1 puis faux partout ailleurs : 5×5 au milieu d'une salle de 55. Le rayon par défaut (`scale * 2`) est maintenant le seul utilisé, et le pad fait 21×21.

### Ce que les formes ont exigé

Les familles de formes sont écrites en proportions là où elles peuvent l'être (une entaille fait 35 % du côté, une barre un tiers de la largeur), mais quelques épaisseurs sont **absolues** : une aile d'une cellule, une prise de deux cellules. À ×5, une aile d'une cellule sur une salle de 55 est un cheveu — et aucune porte de 5 ne s'y ouvre. Ces épaisseurs sont exprimées en `UNIT` = `DUNGEON_CONFIG.scale`, et une forme qui **ne peut pas héberger le minimum de portes est refusée dans `generateShape`** (`NO_OPENING`), au lieu d'être renvoyée au générateur qui la refusera ensuite.

Mesure sur 200 formes à ×5, après les correctifs : **0 forme sans porte**, moyenne **3,91** portes (histogramme 2 : 22, 3 : 48, 4 : 56, 5 : 74).

### Mesure de la nouvelle échelle

| Mesure | ×1 | **×5** |
| --- | --- | --- |
| taille des salles | 4–11 blocs | **16–55** (28 % de petites, 16 % de grandes : paliers) |
| hauteur sous plafond | 4 | **5** |
| largeur des couloirs | 1 | **5** |
| genèse d'une salle (blocs, passages compris) | ~360 | **6 500 à 6 900** (blocs du donjon ÷ salles) |
| donjon de 28 à 36 salles | 13 584 blocs | **183 000 à 245 000 blocs** |
| temps de construction | 2,65 s | **6,2 à 7,5 s** |
| salles atteignables à pied | toutes | **toutes** — 28/28, 33/33, 36/36, 35/35 sur quatre difficultés |

Le temps ne suit pas linéairement les blocs : le budget par tick absorbe une partie du surcoût, et le graphe s'arrête quand la difficulté est atteinte. Un donjon de ×5 est plus long à apparaître proportionnellement moins que ses vingt-cinq fois de surface, mais chaque tick coûte ce qu'il coûtait, parce que le lot et le budget ont suivi.

## Ce qui n'est pas fait

- **la persistance** : rien n'est encore écrit en base. Un redémarrage reconstruit depuis la graine, ce qui est correct mais ne conserve ni les salles déjà construites ni la position des joueurs (Phase 5) ;
- **les minerais** : l'emplacement de l'appel est prêt (`allowMining`, liste vide), il reste à décider où les poser ;
- **le pad de progression** n'est posé que si une salle le demande ; le service ne choisit pas encore laquelle ;
- **les ponts** (`bridge`) partagent le code des passages et restent rares : le réseau se ferme désormais par recouvrement de portes (`minConnectionOverlap`), donc les boucles existent, mais un pont qui traverse un vide entre deux salles non jointives reste l'exception ;
- **le pad posé dans les salles autres que l'entrée** : le constructeur sait le faire (`roomBlocks(..., { pad })`), le service ne choisit pas encore quelle salle le porte ;
- **les tests en jeu** : tout ce qui précède est vérifié contre des faux. Les questions ouvertes de `docs/ARCHITECTURE.md` §19 (portée réelle de la DB de lobby, comportement de `setCantChangeBlockRect` sur un volume) demandent une session Bloxd réelle.
