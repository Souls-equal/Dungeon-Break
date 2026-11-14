# Dungeon Break — Bloxd.io

Lobby de sélection de difficulté, compte à rebours individuel, puis un donjon généré **chunk par chunk** : une salle est un modèle de 32×32×32 copié d'un seul appel. Le code ne lit que ce que tes constructions lui donnent : le **Bedrock** du chunk pour savoir où il en est, et le **Concrete** du niveau suivant pour la progression.

Les règles de travail du projet sont dans [`AGENT_RULES.md`](AGENT_RULES.md) ; l'architecture et les limites vérifiées de l'API sont dans [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Pourquoi ce moteur

```js
api.copyChunk(fromPos, toPos);   // 32 768 blocs, un appel
```

La documentation Bloxd décrit exactement ce cas d'usage : « *storing 'template' chunks that can be continuously copied to a new position* ». Le générateur précédent construisait chaque salle avec ~20 000 `api.setBlock`, ce qui a produit une longue liste de correctifs — réparation de sols, records de chunk, garde-temps de tick, plafonds de mémoire. Une copie supprime le coût, et avec lui la classe entière de bugs : une salle existe ou elle n'existe pas.

| | Avant | Maintenant |
| --- | --- | --- |
| Une salle | ~20 000 `setBlock` | 1 `copyChunk` |
| Code du donjon | ~12 000 lignes, 18 modules | 1 532 lignes, 4 modules |
| Niveaux | tous sur `Y = −1000`, au même endroit | un cube tiré au hasard par entrée |
| Chute à l'arrivée | boîte de murs de 3 blocs | gravité coupée le temps de la copie |

## Installer dans Bloxd

1. Dans ton monde Bloxd, construis les pads de difficulté avec les blocs **Concrete** ci-dessous, à l'endroit où tu veux le lobby. Le joueur doit pouvoir marcher sur leur surface. Chaque salle doit avoir **une couche de Bedrock en bas et une en haut** du chunk, et le **Concrete** du niveau suivant **dans la salle** : le code n'écrit aucun bloc.
2. **Remplis la table des modèles** — c'est la seule chose que le code ne peut pas deviner, voir la section suivante.
3. Ouvre le **World Code** (`F8` par défaut), colle le contenu de [`world-code/worldCode.js`](world-code/worldCode.js), sauvegarde.
4. Entre dans le monde (spawn `10, 21, 10`) et marche sur un pad. Le compte à rebours s'affiche ; quitter le pad l'annule.

## Remplir les modèles de salles

Tout est dans [`src/dungeon/templates.js`](src/dungeon/templates.js). **Une seule liste de salles**, partagée par les huit difficultés.

```js
const READY_ROOMS = [
  [-2, 1, 0],
  [-4, 1, 0],
  // ...
];

globalThis.ROOM_TEMPLATES = globalThis.ROOM_TEMPLATES || { rooms: READY_ROOMS };
```

**Les coordonnées sont en chunks, pas en blocs.** `[-2, 1, 0]` est le chunk qui commence au bloc `-64` : un pas de 1 en x vaut 32 blocs, deux pas valent 64. La série `-2, -4, -6…` laisse donc un chunk de vide entre chaque salle, et chacune est un chunk distinct — c'est tout ce que `copyChunk` demande. La conversion chunk → bloc se fait à un seul endroit (`chunkToBlock`), une seule fois, quand la table est lue.

**Une salle n'est qu'une coordonnée.** Pas d'identifiant, pas de portes à déclarer, pas de hauteur, pas de forme. Elle est connue par sa position dans la liste (`#12`), et le générateur en pose une **au hasard** pour chaque chunk qu'il remplit.

Les 15 salles construites sont dans la table, les 60 restantes en commentaire — remplir une entrée, c'est effacer deux `//`.

### Ce que le générateur exige d'une salle

Une seule chose, et elle est dans ta construction : **une couche de Bedrock en bas et une en haut du chunk**, sol et plafond, comme les Bedrock du Nether.

C'est tout le contrat, et il sert à deux choses d'un coup :

1. **Charger** la destination : le moteur lit un bloc dans le chunk, et le serveur l'envoie ; deux ticks plus tard il est là et accepte une copie.
2. **Savoir si une salle est déjà là** : le moteur lit une seule case, au **centre du chunk** (local 16,16), sur la couche du bas puis sur celle du haut. Bedrock → la salle est là, rien n'est recopié, même après un redémarrage. Autre bloc → ce n'est pas une salle : la copie se fait par-dessus.

La case lue est celle où le joueur atterrit et où se trouve la plaque Concrete : le centre de la salle. **Seul le Bedrock compte comme preuve** — sinon du terrain ordinaire, à la même profondeur, passerait pour une salle et le moteur sauterait la copie.

La hauteur du sol, elle, est lue et jamais configurée : le moteur remonte la colonne du milieu et prend le premier bloc qui n'est ni de l'Air ni du Bedrock.

**Le générateur n'écrit jamais un bloc.** Aucune case de tes constructions n'est réservée, aucun témoin, aucune plaque, aucune réparation : une salle est un chunk, et les seuls gestes du moteur sont `copyChunk` et des lectures.

### Changer la liste change tous les donjons

Le tirage est `hash(niveau, chunk) % nombre_de_salles`. Ajouter la 16ᵉ salle redistribue donc **toutes les salles des huit niveaux**. C'est accepté pendant la construction ; quand le monde vaudra la peine d'être conservé, on passera à un modulo fixe pour qu'une salle ajoutée plus tard ne déplace pas ce qui existe déjà.

## Boutique : revenir au spawn

Le spawn normal du jeu est désactivé dans ce monde ; c'est donc le code qui le fournit. Au chargement, le World Code crée une catégorie **Utilities** avec un seul objet, **Teleport to spawn** :

| Champ | Valeur |
| --- | --- |
| Catégorie | `Utilities` |
| Objet | `Teleport to spawn` |
| Image | `Lime Concrete` |
| Coût | `0` (gratuit, `canBuy: true`) |
| Bouton | `Teleport` |

Le clic est capté par `onPlayerBoughtShopItem`, qui fait **deux choses dans cet ordre** : téléporter en `[10, 21, 10]`, puis oublier le donjon du joueur. L'oubli est ce qui arrête la génération : le tick ne lit que les joueurs qui ont un donjon, donc la file, le plan et les copies s'arrêtent net, et la place est rendue. Un joueur au spawn n'est jamais un joueur avec un donjon — même s'il clique pendant les ticks de chargement de l'entrée.

`npm run build` vérifie que `createShopItem` est bien dans le bundle : sans boutique, un joueur sorti d'un donjon n'aurait plus de retour.

## Commandes de debug

| Commande | Effet |
| --- | --- |
| `/dbg` | Niveau, couche tirée, position, chunk, origine, salles prévues / en file / posées |
| `/dbg templates` | Tous les modèles des niveaux utilisés, avec lisible / illisible |
| `/dbg mem` | Un donjon par ligne, avec son origine, puis les compteurs qui doivent rester bornés |
| `/dbg seed` | Le niveau et sa couche tirée, en une ligne |

Une capture d'écran + `/dbg templates` suffisent à diagnostiquer une salle manquante.

## Pads de difficulté

| Bloc à poser | Difficulté |
| --- | --- |
| Lime Concrete | Very Easy |
| Light Blue Concrete | Easy |
| Yellow Concrete | Medium |
| Orange Concrete | Normal |
| Red Concrete | Hard |
| Purple Concrete | Insane |
| Gray Concrete | Ultra Insane |
| Black Concrete | Hell |

Le lobby n'offre que Very Easy, Easy et Medium. Dans un donjon, c'est un bloc Concrete **de la salle** qui mène à la difficulté suivante, jusqu'à Hell : le code lit le bloc sous les pieds du joueur (`onBlockStandStart`), il ne pose rien. Construis donc la plaque du niveau suivant dans tes salles.

Un niveau **n'a pas de hauteur fixe** : chaque entrée tire son propre cube (voir « Génération »), donc deux donjons ne peuvent pas se rencontrer, ni horizontalement ni verticalement.

Tous les textes visibles par les joueurs sont en anglais.

## Génération

- **Grille de chunks.** Les `viewChunks: 1` chunk autour de chaque joueur (3×3, soit 96 blocs de côté) sont mis en file, du plus proche au plus loin. Le joueur est toujours au milieu d'un anneau complet, donc le bord du monde bâti n'est jamais en vue.
- **Une sonde par chunk candidat.** Un `getBlock` sur le Bedrock du chunk répond à tout : pas envoyé → il est demandé et prêt **2 ticks** plus tard ; déjà bâti → on passe ; vide → il est mis en file.
- **Une copie par tick et par donjon.** La copie elle-même se fait en moins d'un tick ; elle n'est jamais doublée dans un tick.
- **Un scan toutes les 4 ticks**, borné à 8 nouvelles salles par scan. Un joueur immobile dont les salles sont faites ne coûte aucune lecture.
- **Rien n'est écrit dans un chunk.** Le moteur ne connaît que `copyChunk` et des lectures : c'est ce qui rend les salles sûres à construire à la main. **Une seule exception**, demandée par le propriétaire : le record « salle nettoyée » de la section *Mobs*, posé avec `setBlockData` — des données **sur** un bloc, jamais un bloc.
- **Une salle est reconnue par son Bedrock**, pas par un compteur : le tick suivant la copie, la sonde relit la destination et c'est le monde qui confirme. `/dbg mem` sépare les salles vues (`rooms`), celles en vol (`in flight`) et les chunks en cours de chargement.
- **Entrée.** Demande des modèles, téléportation au centre du chunk d'entrée, `chunkLoadTicks: 2`, copie de la salle d'entrée (si elle n'y est pas déjà), tirage de l'atterrissage, puis le joueur y est posé. La gravité est coupée pendant ces ticks, ce qui remplace la boîte de murs de l'ancien moteur. Un sol qui ne vient pas est réessayé `entryMaxTicks` fois, puis c'est un message — jamais un joueur dans le vide.
- **Un donjon par entrée, à une place tirée au hasard dans les trois directions.** Chaque entrée tire `x` et `z` en chunks dans `-3125..3124` (**±100 000 blocs**) et `y` dans `32..3124` (**blocs 1 000 à 100 000**, `spawnChunkYMin/Max`), à au moins `spawnSeparation: 20 000` blocs de toute autre entrée vivante dans **les trois directions** (`spawnDraws: 24` essais, la plus éloignée l'emporte). Quitter libère la place. Deux joueurs ne peuvent donc pas se croiser, et rien n'est écrit dans les chunks : c'est le jeu qui vide la carte quand le propriétaire active le réglage. `/dbg` affiche l'origine `x,y,z`, `/dbg mem` celle de chaque donjon.
- **Atterrissage testé là où le joueur sera.** La salle d'entrée est copiée d'abord, puis le sol est lu **dans le chunk de destination** : la position de départ est ce sol + `spawnAboveFloor = 7` (la mesure en jeu, plus les 5 blocs demandés). Ensuite le moteur ne suppose plus rien : il teste la case du milieu puis **le tour** (8 cases), en exigeant que la case **et celle au-dessus** soient de l'Air — les deux cases d'un joueur debout. Si rien ne passe, il monte de **+1** (2 fois) ; si tout est bloqué, il tire **une autre colonne dans le même chunk** (3 fois). Rien ne marche → un message, jamais un joueur dans la pierre. Le joueur reçoit `Landed at y … · floor block at y …`, et le bloc sous ses pieds est relu après la téléportation.

## Mobs : des salles à nettoyer

- **Le donjon est une série de salles à vider.** À l'entrée dans une salle, les **quatre salles autour** (x+1, x−1, z+1, z−1) reçoivent leurs mobs. Les salles déjà nettoyées n'en reçoivent jamais.
- **Entrer dans une salle laisse ses mobs vivants** et tue ceux des **autres** salles : on ne perd pas le combat qu'on vient de commencer, on ne traîne pas celui qu'on a laissé derrière.
- **Tuer le dernier mob d'une salle la rend *clear*.** Le record est écrit **dans la salle**, sur le bloc du coin (`mobClearCell`), avec `setBlockData` : il survit à un redémarrage et à un retour plus tard, et une salle clear ne se remplit plus jamais. Le joueur reçoit `CLEAR — nothing left in this room.`
- **La salle du spawn est clear d'emblée** : un run ne commence jamais par un combat.
- **Le bon Y est celui du joueur.** Sa position d'atterrissage est vérifiée une fois, et c'est cette hauteur (`spawnY`) que prennent tous les mobs du run : aucun sol n'est recalculé. Une case n'est retenue que si **elle et celle au-dessus ne sont pas solides** — `api.getBlockSolidity`, pas « est-ce de l'Air » : le donjon contient des plantes, et on les traverse. Les plaques de difficulté sont exclues.
- **Une salle doit exister** avant de recevoir des mobs : le moteur ne connaît pas la réponse (« chunk vide » et « air d'une salle » se lisent pareil), il ne spawn que dans les chunks que sa propre sonde a confirmés (`placed`).
- **Le bestiaire s'ouvre avec la difficulté** (`MOB_ROSTER`). Chaque niveau tire parmi **tous** les mobs débloqués jusqu'à lui — une salle de Hell est un mélange, pas une seule espèce :

  | Niveau | Ajoute | Total |
  | --- | --- | --- |
  | Very Easy | Zombie | 1 |
  | Easy | Draugr Zombie, Skeleton | 3 |
  | Medium | Draugr Skeleton | 4 |
  | Normal | Cave Golem | 5 |
  | Hard | Armour Collector | 6 |
  | Insane | Furnace Knight, Lil Knight | 8 |
  | Ultra Insane | Draugr Knight | 9 |
  | Hell | Scorpion | 10 |

- **Chaque mob a ses propres multiplicateurs**, appliqués **avant** ceux du niveau : Zombie ×1 partout, Draugr Zombie PV ×1,15 / dégâts ×1,2, Skeleton PV ×0,7, Draugr Skeleton PV ×0,8 / dégâts ×1,2, Cave Golem PV ×1,4 / vitesse ×0,95, Armour Collector PV ×2 / dégâts ×1,75 / vitesse ×0,95, Furnace Knight PV ×2 / dégâts ×2 / vitesse ×0,95, Lil Knight PV ×1,75 / dégâts ×1,8 / vitesse ×1,25, Draugr Knight dégâts ×2 / vitesse ×1,6, Scorpion PV ×1,75 / dégâts ×1,6 / vitesse ×1,15. Un Skeleton en Hell, c'est donc 0,7 × 5 de PV — fragile **et** dur.
- **Le type est tiré au hasard à chaque mob** ; un type que le jeu refuse — une exception, ou un `null` dans une salle où un autre type a marché — est abandonné **pour ce niveau seulement** : un nom que Hell refuse ne prive pas Very Easy de son seul mob. Les multiplicateurs de `MOB_TUNING` (`count`, `health`, `damage`, `speed`) vont de Very Easy (2 mobs, ×1) à Hell (5 mobs, ×5 PV, ×3 dégâts, ×1,5 vitesse).
- **Un spawn est asynchrone** : `attemptSpawnMob` rend un id avant que le mob existe, donc les statistiques sont appliquées **au tick suivant** (file `pendingTuning`).
- **Quitter un donjon tue ses mobs**, et **mourir aussi** : un mob que le jeu retire tout seul (trop loin, trop de mobs pour le nombre de joueurs) est oublié **sans** compter comme une salle nettoyée.

### Mourir, et revenir

- **La mort ne coûte pas le donjon.** `onRespawnRequest` rend **la position** de l'atterrissage d'entrée — vérifiée à l'arrivée, et jamais recalculée : on revient à l'entrée du **même** niveau, mêmes salles, mêmes salles nettoyées, même hauteur. Rien n'est retiré ni redessiné. (Rendre `true` aurait voulu dire « je téléporte moi-même » : le joueur serait resté là où il est mort.)
- **Les mobs du donjon meurent avec le joueur**, et **les quatre salles autour de l'entrée sont repeuplées**. Sans ça, on revient dans le tas qui vient de nous tuer, collé à l'entrée — ou dans un donjon où il ne peut plus y avoir de combat. Message : `Back at the entrance — the rooms around you have been restocked.`
- **Entrer dans un niveau ne ressuscite plus les vieux mobs** : l'ancien donjon est nettoyé avant d'être libéré, et le tick ne prend plus la téléportation d'arrivée pour « le joueur vient d'entrer dans une salle » (l'entrée est déjà clear).

## Sources et version compacte

Le code lisible est dans `src/` :

```
src/dungeon/config.js      constantes, table des difficultés
src/dungeon/templates.js   coordonnées des modèles, tirage déterministe
src/dungeon/loader.js      file, copie
src/dungeon/service.js     entrée, atterrissage, pad, rapports
src/utils/scheduler.js     scheduler piloté par le callback tick
src/worldCode.js           lobby, pads, /dbg
```

- `npm ci` installe le compilateur de build.
- `npm run build` régénère le fichier compact.
- `npm run watch` le régénère à chaque sauvegarde dans `src/`.
- `npm run check` vérifie que le bundle est à jour, valide les syntaxes, et refuse un bundle où `copyChunk`, `createShopItem` ou la table des modèles ont disparu au minification.
- `npm test` lance les 97 tests : moteur, configuration, et le bundle réel exécuté dans un `vm` contre un faux serveur qui applique les règles de Bloxd.

Le workflow GitHub vérifie la version générée sur les Pull Requests et resynchronise `world-code/` après un merge dans `main`.

## Limites connues

- **`chunkLoadTicks: 2`** vient d'une mesure en jeu : deux ticks après un `getBlock`, le chunk est là et accepte une copie. Si une salle n'apparaît pas, c'est le premier chiffre à augmenter — et il n'y a qu'un endroit à changer.
- **Chaque salle doit avoir son Bedrock en bas et en haut.** C'est le seul contrat, et c'est ce qui permet au moteur de charger, de reconnaître et de ne jamais recopier une salle.
- **Une salle sans Concrete du niveau suivant est un cul-de-sac.** Le code ne pose aucune plaque : il lit le bloc sous les pieds du joueur.
- **Pas encore de minerais, de butin, ni de fin de partie.**
- **Les dix noms du bestiaire sont ceux du jeu, à sa casse près.** Six sont confirmés par la documentation Bloxd (`Draugr Zombie`, `Draugr Skeleton`, `Cave Golem`, `Draugr Knight`, `Zombie`, `Skeleton` — les deux derniers cités par l'encyclopédie, pas par la table des variations) ; `Armour Collector`, `Furnace Knight`, `Lil Knight` et `Scorpion` viennent de la liste des mobs hostiles du jeu, sans confirmation d'API. Un nom refusé ne casse rien : il est abandonné pour ce niveau, et `/dbg level` dit lequel.

## Documentation Bloxd utilisée

- [API Reference](https://bloxd.io/docs/api-reference) — `copyChunk`, `setBlock`, `getBlock`, `setPosition`, `setClientOptions`, `setClientOption`, `createShopItem`, `isNearInterrupt`
- [Callbacks](https://bloxd.io/docs/callbacks) — `onBlockStandStart`, `onBlockStandStop`, `onPlayerBoughtShopItem`, `onPlayerJoin`, `onPlayerLeave`, `onRespawnRequest`, `tick`
- [Client Options](https://bloxd.io/docs/client-options) — `gravityMultiplier`, `middleTextUpper`
