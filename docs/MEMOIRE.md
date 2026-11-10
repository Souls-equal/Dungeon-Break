# `InternalError: out of memory` — toutes les causes possibles

Ce document répond à une question précise : **quelles variables peuvent stocker
une quantité de données qui grandit avec le temps ?** Il a été écrit après avoir
reproduit l'erreur en local, pas après l'avoir supposée.

## Ce que dit l'erreur

`InternalError: out of memory` est levée quand le tas du bac à sable Bloxd est
épuisé. Elle n'a **rien à voir** avec `InternalError: interrupted` (un tick trop
long) : les deux peuvent arriver ensemble, mais l'un est une question de temps,
l'autre une question de volume retenu.

Dans la quasi-totalité des cas, ce n'est pas une grosse allocation unique, c'est
**une structure qui grossit un peu à chaque tick** et ne redescend jamais. Un
monde qui tourne 20 minutes avec une fuite de 100 Ko par tick meurt sans qu'on
puisse désigner une ligne coupable.

## Reproduction locale (avant correction)

Un faux monde qui ne stocke rien (chaque `setBlock` est un no-op) et **un seul
joueur** qui avance dans le donjon, mesuré sur `Very Easy`, qui demande **10
salles** :

| tick | salles | tas |
| --- | --- | --- |
| 500 | 35 | 106 Mo |
| 1000 | 52 | 166 Mo |
| 1500 | 56 | 202 Mo |
| 2000 | 79 | 354 Mo |
| 2500 | 92 | 411 Mo |
| 3000 | 108 | 591 Mo |

Le donjon ne s'arrêtait **jamais** de grandir, et le tas avec lui. Sur `Hell` avec
un monde qui garde ses blocs, le processus Node mourait en `JavaScript heap out
of memory` vers 4 000 ticks.

## La troisième cause, trouvée au profil mémoire

Une fois les deux premières corrigées, le donjon ne grandissait plus — mais un
`Hell` de 48 salles retenait quand même **101 Mo**. Le graphe est petit (6,7 Mo
pour 35 salles et leurs connexions), donc la mémoire était ailleurs : dans les
**allocations de passage**.

Un profil mémoire (`node --heap-prof`) a désigné une seule ligne :

```
28,3 Mo  dungeonCellIndex  builder.js:135
```

`buildPassage` appelait `dungeonCellIndex` — l'index de **toutes** les cellules de
salle et de **toutes** les cellules de passage du donjon — à chaque construction
de passage, **deux fois par passage** : une fois pour le test de chargement, une
fois pour le plan. Le commentaire disait « recalculé à chaque fois » ; personne
n'avait mesuré ce que coûtait un recalcul de cette taille.

Corrigé en deux temps, chacun mesuré :

1. Ne construire que ce que `passageBlocks` lit vraiment : les cellules du
   passage, et l'ensemble des cellules de salle. **28,3 Mo → 19,1 Mo.**
2. Ne plus matérialiser l'ensemble des cellules de salle du tout : la seule
   question posée est « cette cellule est-elle une salle ? », et elle porte sur les
   quelques centaines de cellules du passage en cours. `roomCellLookup` y répond
   depuis les masques, sans une seule chaîne allouée. **19,1 Mo → 0,2 Mo.**

Résultat sur le même donjon, tout le reste identique :

| | avant | après |
| --- | --- | --- |
| tas retenu (Hell, 35 salles) | 63 Mo | **10 Mo** |
| tas retenu (Hell, 48 salles) | 104,6 Mo | **11,4 Mo** |
| p99 d'un tick | 16,7 ms | **7,4 ms** |
| moyenne d'un tick | 0,51 ms | **0,39 ms** |
| blocs écrits, salles finies, échecs d'audit | 212 468 / 48 / 0 | **212 468 / 48 / 0** |

Le monde est byte pour byte le même. Un test vérifie que `roomCellLookup` répond
exactement comme l'ensemble complet, cellule par cellule, sur un vrai donjon —
deux façons de répondre à la même question doivent donner la même réponse.

## Causes trouvées, par ordre d'impact

### 1. Aucun plafond de salles — **la cause principale, corrigée**

`DIFFICULTIES` déclare `rooms: 10` pour Very Easy, `48` pour Hell. **Personne ne
lisait ce nombre** : le contrôleur générait tant qu'il restait une porte en
attente, et une frontière de porte ne s'épuise jamais vraiment — un donjon
continûment connecté en offre toujours une. Résultat mesuré : Very Easy à 114
salles, Hell à 200 et plus, chacune coûtant ses ouvertures, ses connexions, son
plan et ses blocs.

*Correction* : `createDungeonController({ maxRooms })`, alimenté par
`difficulty.rooms` dans `service.js`. À la cible, la génération s'arrête et les
files de découverte/génération sont vidées (`stats.capped` compte les refus).

Mesure après correction, même faux monde : Very Easy **10 salles**, tas stable
autour de 20 Mo ; Hell **48 salles**, sur 3 000 ticks — plus aucune croissance.
Le niveau absolu du tas a ensuite baissé encore avec le correctif d'allocation
ci-dessous (voir « La troisième cause »).

### 2. Les plans de salles jamais libérés — corrigé

`createRoomWriter` garde, dans `planned`, la **liste complète des blocs** de
chaque salle pour pouvoir la reprendre au curseur. Cette liste n'était jamais
effacée : `forget()` existait mais rien ne l'appelait. Sur un donjon à 175 salles,
**562 851 blocs** (objets `{ x, y, z, name, phase }`) restaient en mémoire après
la fin du build — et avec la cause 1, ce nombre n'arrêtait jamais de monter.

*Correction* : le plan est libéré à la fin de la salle (`worldBuilder.buildBatch`).
Rien ne le lit après : l'audit recalcule les blocs attendus depuis la géométrie,
et `reopenDoorways` efface quelques cases sans lui. Libération : ~10 % du tas sur
Hell, et surtout **plus de croissance** liée au nombre de salles.

> Le gain mesuré est modeste parce que la cause 1 était dominante. La fuite était
> réelle pour autant : elle seule aurait suffi à faire grossir un long donjon.

### 3. Structures indexées par le donjon — bornées, mais à surveiller

Ce sont les seules structures dont la taille dépend légitimement du nombre de
salles. Elles sont donc bornées par le plafond de la cause 1, et `/dbg mem`
affiche leurs tailles.

| Structure | Où | Coût par élément | Borné par |
| --- | --- | --- | --- |
| `rooms`, `connections` | `dungeonManager` | un objet salle / connexion | `maxRooms` |
| `room.openings[]`, `room.connections[]` | `dungeonManager` | 2 à 5 par salle | `maxRooms` (mesuré : 3,8 ouvertures/salle, 2 connexions/salle) |
| `corridorCells` | `dungeonManager` | 1 chaîne `"x,y"` par case de couloir | nombre de connexions |
| `index.regions`, `index.openings`, `index.rooms` | `spatialIndex` | 1 entrée + une chaîne de région par salle | `maxRooms` |
| `rooms` (états de build) | `worldBuilder` | 1 objet par salle **plus son plan** (cause 2) | `maxRooms` |
| `sealedAnchors` | `worldBuilder` | 1 chaîne `"x,y,z"` par chunk | nombre de chunks |
| `savedChunks` | `service` | 1 chaîne par chunk | nombre de chunks |
| `auditQueue` | `worldBuilder` | 1 identifiant par salle terminée | vidée à chaque audit |

### 4. Files de travail — bornées, mais elles étaient stériles

`queues.js` garde trois listes (`discovery`, `generation`, `build`) avec une
carte d'appartenance. `discovery` est plafonnée à `maxDiscoveryPerCycle`, les
autres se vident en servant. **Risque** : une entrée jamais servie (porte
`pending` supprimée, salle disparue) reste indéfiniment. Le contrôleur sort les
entrées mortes en les `take()` puis en les ignorant, donc elles ne s'accumulent
pas — mais c'est la structure à regarder en premier si `/dbg mem` montre une file
qui ne redescend pas.

### 5. Records de chunk — un par chunk, écrits en boucle

`savedChunks` (une chaîne `"x,z"` par chunk) et les données de bloc écrites par
`saveOneChunk` (un record par chunk, un par tick). Les records sont **remplacés**,
pas accumulés, et la carte des chunks est bornée par le nombre de chunks touchés
par le donjon (~70 à 170). La taille d'un record a été mesurée : **142 octets**
en moyenne, 1 200 maximum par construction (test dédié). Ce n'est pas une source
de fuite — mais c'est la seule structure qui **écrit** dans le monde à chaque
tick, donc celle qui peut déclencher `interrupted` (voir plus bas).

### 6. État par joueur — petite fuite, corrigée pour l'essentiel

| Structure | Nettoyage | Risque |
| --- | --- | --- |
| `playerDungeons`, `controller.players` | supprimés au `onPlayerLeave` | faible, si tous les départs passent par là |
| `lobbyCountdowns` | arrêté au départ | faible |
| `debugHudEnabled`, `debugHudLines` | supprimés au départ | faible depuis le correctif `/dbg` |
| `suspended`, `inProgress` | supprimés à la fin de l'opération | faible |

Le point d'attention n'est pas la fuite d'un joueur, c'est un **départ qui ne
passe pas par `onPlayerLeave`** (crash du client, changement de monde) : le joueur
resterait éternellement dans `players` et le contrôleur continuerait de découvrir
des portes autour de son fantôme. Limite connue, sans garde-fou aujourd'hui.

### 7. `lastRejections` — jamais alimenté

`dungeonManager` expose `lastRejections`, un tableau **jamais écrit** (aucun
`push`). Ce n'est donc pas une fuite aujourd'hui, mais c'est exactement la forme
d'une fuite future : un tableau « des dernières refus » qui, le jour où quelqu'un
le remplira, grandira sans plafond. À plafonner par construction le jour où il
sert.

### 8. Journalisation

`log()` écrit une ligne par salle ratée, par réparation, par refus remarquable.
Le garde-fou existe pour le scheduler (`MAX_ERROR_LOGS_PER_TIMER = 3`), **pas pour
`api.log`** : un donjon qui échoue 500 fois produit 500 lignes. Ce n'est pas une
fuite de notre mémoire JavaScript, mais c'est une allocation par tick côté
serveur, et c'est le genre de volume qui participe à l'épuisement du bac à sable.

### 9. Ce qui ne fuit pas (vérifié)

- `debug.js` ne garde rien entre deux appels : les rapports sont construits à la
  demande et jetés.
- `geometry.js`, `openings.js`, `shapes.js` allouent des tableaux locaux qui
  meurent avec l'appel ; seul `spatialIndex` et `dungeonManager` retiennent.
- Les blocs ne sont pas mémorisés côté moteur : c'est le monde qui les garde, en
  dehors de nos compteurs.

## Comment vérifier en jeu

```
/dbg mem
```

Affiche, par difficulté : `rooms X/plafond · capped · openings · links` puis
`unfinished · built · queued · chunks · records`. Un donjon dont `rooms` s'arrête
à son plafond et dont le tas continue de monter est un autre bug que celui dont
`rooms` ne s'arrête jamais — cette ligne est ce qui les sépare.

## Corollaire : le stockage par bloc a été déplacé

L'ancre d'un chunk était posée **au niveau du sol** (voir `docs/ARCHITECTURE.md`
§3.8). C'était une erreur : à ce niveau, la case est structurelle, donc une salle
dont le contour couvre le coin du chunk y écrit un bloc de sol ou un mur, **et
cette écriture efface la donnée** (« *Data is cleared when block changes* »). La
réservation ne protégeait que si l'ancre arrivait en premier.

L'ancre est maintenant **une case au-dessus du sol** (`floorY + 1`), au coin du
chunk : c'est de l'air dans un donjon normal, aucune salle n'y écrit jamais. Un
bloc plus bas (`floorY - 1`) serait très souvent dans le chunk du dessous, non
chargé — l'écriture y serait perdue sans erreur.
