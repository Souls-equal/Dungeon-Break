# Phase 4 — construction physique

**Livré.** `builder.js`, `worldBuilder.js`, `service.js`, et le rebranchement de l'hôte (`src/worldCode.js`). Le moteur ne décide plus seulement : il pose des blocs. L'ancien générateur (`src/dungeon/generator.js`, 1 583 lignes) et ses deux fichiers de tests sont supprimés — c'est le remplacement, pas une cohabitation. `npm test` : **148 tests verts**.

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
| 1 | `Air` **au-dessus du plafond** (niveaux `wallHeight+2` à `+4`) | idempotence d'une reconstruction |
| 2 | sol, toutes les cellules de la forme, pierre tirée une par une | on marche avant d'avoir des murs |
| 3 | murs, linteau compris, cellules de passage sautées jusqu'à `passageHeight` | le mur n'est jamais plein puis percé |
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

Trois donjons complets, faux serveur, joueur immobile dans l'entrée :

| Donjon | Salles | Connexions | Passages construits | Salles atteignables à pied | Écritures perdues |
| --- | --- | --- | --- | --- | --- |
| alpha | 20 | 20 | 20 | **20 / 20** | 0 |
| beta | 30 | 33 | 33 | **30 / 30** | 0 |
| gamma | 38 | 37 | 37 | **38 / 38** | 0 |

Le test d'intégration `tests/engine/service.test.js` fait exactement cela : il part de l'entrée, marche de cellule en cellule au niveau du sol, et échoue si une salle construite n'est pas atteignable.

**Texture.** Chaque bloc structurel est tiré **un par un** dans `"Stone"`, `"Messy Stone"`, `"Smooth Stone"`, `"Stone Bricks"`, `"Cracked Stone Bricks"`, `"Mossy Stone Bricks"`. Sol : famille des briques ; plafond : `Smooth Stone` ; murs et linteaux : la palette entière. Le tirage est un hachage de `(graine de salle, cellule, niveau)`, donc :
- une salle interrompue puis reprise a les mêmes pierres qu'une salle construite d'un trait ;
- une salle reconstruite depuis sa graine est identique ;
- deux salles voisines ne se ressemblent pas.

Cela interdit `setBlockRect` pour la structure — un rectangle est uniforme, et il est **plafonné à 360 blocs par appel**, avec **exactement trois arguments** : `setBlockRect([x,y,z],[x1,y1,z1], "Air")`.

La décision de conception qui compte : **aucune cellule n'est écrite deux fois**. La passe `clear` de la proposition initiale vidait le volume du sol au plafond, puis la passe `floor` réécrivait le sol — la même cellule, deux valeurs, donc un monde qui dépend du découpage en lots. Elle est limitée aux niveaux au-dessus du plafond, et un test l'assure : 0 doublon sur toutes les salles d'un donjon.

Une ouverture `pending` (qui ne mène nulle part) est **murée** : c'est un cul-de-sac, pas un trou dans le vide. Seules les ouvertures `connected` percent un passage. Corollaire vérifié : le pad n'est jamais posé sur une cellule de passage, sinon traverser une porte téléporterait.

## Reprise et vérification

`writeRoom` renvoie un curseur et refuse de repartir de zéro sans lui (`room r1.2 is half built: an explicit cursor is required to resume it`). Ce refus est volontaire : la version implicite réécrivait des blocs et renvoyait quand même `done`.

Le pont vérifie ce qu'il a écrit par `getBlock` — les pads et les passages toujours, le reste un bloc sur huit — répare **une fois**, puis déclare la salle `failed` si elle reste fausse. Une salle fausse déclarée `built` est le pire des états : le joueur tombe dedans et rien ne le signale.

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

Mesuré sur un faux serveur : entrée prête au tick 9, 457 blocs, 25/25 cellules du pad posées, **0 écriture perdue**, jamais plus de 80 blocs dans un tick. Le sol de la cellule d'atterrissage est relu en `Stone Bricks` au moment exact de `onReady` : rien n'est annoncé avant que le sol existe.

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

Donjon Hell complet sur le faux serveur (3 000 ticks, 150 cycles) :

| Mesure | Valeur |
| --- | --- |
| salles générées | 33 (plafond de la difficulté atteint) |
| blocs écrits | 13 748 |
| écritures perdues (chunk non chargé) | **0** |
| cellules de sol non posées | **0** sur 2 047 |
| salles `built` | 34 / 34 |
| génération cumulée | 125 ms sur 150 cycles |
| construction cumulée | 42 ms |

Le coût par tick reste dominé par la génération, comme en Phase 3 ; la construction ne pèse qu'un tiers du reste.

## Ce qui n'est pas fait

- **la persistance** : rien n'est encore écrit en base. Un redémarrage reconstruit depuis la graine, ce qui est correct mais ne conserve ni les salles déjà construites ni la position des joueurs (Phase 5) ;
- **les minerais** : l'emplacement de l'appel est prêt (`allowMining`, liste vide), il reste à décider où les poser ;
- **le pad de progression** n'est posé que si une salle le demande ; le service ne choisit pas encore laquelle ;
- **les ponts** (`bridge`) partagent le code des passages mais restent rares : 0 sur les trois donjons mesurés ;
- **le pad posé dans les salles autres que l'entrée** : le constructeur sait le faire (`roomBlocks(..., { pad })`), le service ne choisit pas encore quelle salle le porte ;
- **les tests en jeu** : tout ce qui précède est vérifié contre des faux. Les questions ouvertes de `docs/ARCHITECTURE.md` §19 (portée réelle de la DB de lobby, comportement de `setCantChangeBlockRect` sur un volume) demandent une session Bloxd réelle.
