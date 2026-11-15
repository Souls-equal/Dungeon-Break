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
| `/dbg benedictions` | Niveau d'aura sur le plafond, points, dépenses, offre en cours, dernières bénédictions choisies, échelle et chances — hors donjon aussi |

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

## Bénédictions : des points en devise, trois choix, un point par choix

L'aura payée par les salles découvertes a maintenant un usage : **chaque niveau d'aura donne un point**, et un point s'échange contre **une Bénédiction choisie parmi trois** dans la boutique, catégorie **Benedictions**.

Le geste, tel qu'il se joue :

1. la catégorie affiche `Roll a Benediction` (niveau, points, chances) ;
2. ce clic **remplace les tuiles de la catégorie** par **trois** bénédictions tirées au hasard selon leurs probabilités ;
3. cliquer l'une des trois (`Choose`) **dépense le point**, annonce le résultat — chat, bannière, carte —, **referme la boutique**, et les tuiles **reviennent à leur état normal**.

**Les points sont une devise du jeu** (`setCurrency`), affichée sur le HUD avec son icône, et **non persistante** : `persistent: false`. Le compte est en mémoire, le niveau vient du jeu, et **rien ne survit à une reconnexion**.

- **Le tirage réserve un point, le choix le dépense.** Trois cartes sur la table sont une promesse : elle se paie au moment où elle devient un choix, et une promesse non tenue (offre abandonnée) rend son point. C'est ce qui interdit de tirer trois offres avec les points d'un seul niveau.
- **Trois tirages indépendants, tous différents.** Chaque case a les chances de la table (une Mythique à ~0,2 % dans chacune), un doublon est retiré, et un catalogue de moins de trois est servi tel quel.
- **Pas de re-roll gratuit.** Une offre en attente est **réutilisée** : re-cliquer, fermer la boutique, revenir — les mêmes trois.
- **Les points ne sont pas comptés, ils sont calculés** : `niveau d'aura − 1 − dépensés − réservés`. Le niveau est celui du jeu (`getAuraInfo`), relu à chaque rafraîchissement.
- **Rien n'est jamais supprimé.** Une catégorie de shop montre toutes ses tuiles : plutôt que de les supprimer puis de les recréer (ce qui faisait disparaître les autres boutons), le code **réécrit les mêmes clés** — `createShopItemForPlayer` remplace — et celles qui ne s'appliquent pas deviennent **désactivées** (`canBuy: false`) ou **masquées** (`hidden: true`). Aucune tuile ne manque jamais.
- **Tout est par joueur** (`createShopItemForPlayer`, `configureShopCategoryForPlayer`) : un compte de points et une offre ne peuvent pas être des tuiles partagées.

### L'échelle d'aura, et le plafond

Le monde **impose son échelle** à la connexion, par deux options client documentées :

| Option | Valeur | Pourquoi |
| --- | --- | --- |
| `auraPerLevel` | `50` | une salle vaut 10 à 20 d'aura : un point tous les trois à cinq salles |
| `maxAuraLevel` | `40` | le plafond **abaissé** : 39 points dans toute une partie, et l'aura d'un run ne se perd plus dans des niveaux vides |
| `autoRespawn` / `secsToRespawn` | `true` / `3` | la règle de respawn, envoyée dans le même `setClientOptions` |

**Une connexion remet l'aura à 0** (`setTotalAura`), oublie le compte en mémoire, remet la devise à 0 et redessine les tuiles d'un joueur qui n'a rien choisi. Se déconnecter puis revenir, c'est repartir de zéro : c'est la règle demandée, et elle est écrite dans `resetPlayerProgress`.

### Les six raretés

| Rareté | Couleur | Chance |
| --- | --- | --- |
| Common | Gris | ~60 % |
| Uncommon | Vert | ~25 % |
| Rare | Bleu | ~9,6 % |
| Epic | Violet | ~3,6 % |
| Legendary | Orange | ~1,1 % |
| Mythic | Rouge | ~0,2 % |

Les poids sont relatifs et normalisés au tirage : une rareté **sans aucune bénédiction est retirée de la table** au lieu d'être tirée puis relancée, donc la somme des chances fait toujours 100 %. Une rareté reste toujours atteignable.

### Les trois familles

**Bénédictions physiques**, **Bénédictions d'équipement**, **Effets de potions** — chaque bénédiction appartient à une seule famille, indiquée sur sa carte, et **c'est la famille qui choisit l'image** de la tuile : `Block of Iron` (physique), `Block of Diamond` (équipement), `Potion Table` (potions). Rien n'est posé dans le monde, le jeu ne fait que dessiner l'image.

### Le rendu

| Surface | Ce qu'elle montre | Contrainte d'API |
| --- | --- | --- |
| Chat | `Benediction: <nom en couleur> — <famille> · <rareté>`, plus une ligne en texte simple | `CustomTextStyling` : la couleur est un **nom CSS** (`gold`, `lime`…) |
| Bannière | `<nom> — <rareté>` au milieu de l'écran, 2,5 s | `queueMiddleTextUpper`, texte stylé |
| Carte | Nom, rareté, famille et description, en haut à droite, 6 s | `sendTopRightHelper` : icône **Font Awesome**, fond en **`rgb()`** (le hex est refusé par la doc), texte **non stylé** |

Deux couleurs par rareté pour cette raison : un hexadécimal pour le fond de la carte (`rgbOf` le convertit), un nom CSS pour le texte. Les icônes sont des icônes **du jeu** (`IngameIconName`) dans le chat, et Font Awesome sur la carte — c'est le seul format que `sendTopRightHelper` accepte.

### Les neuf bénédictions (qui ne font rien encore)

`Iron Hide`, `Field Rations`, `Quick Feet`, `Sturdy Straps`, `Honed Edge`, `Bitter Draught`, `Second Wind`, `Ghost Step`, `Heart of the Dungeon` — au moins une par famille et une par rareté jusqu'à Mythic. **Chacune dit « (No effect yet.) »** : la mécanique, les raretés et le rendu sont là, les effets viendront.

`/dbg benedictions` affiche le niveau sur le plafond, les points, les dépenses, l'offre en cours, les dernières bénédictions choisies, l'échelle d'aura et les chances — **hors donjon aussi**, puisque le niveau s'y gagne.

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

### Coffres : une clé par coffre

- **Cliquer sur un `Chest`** donne une clé, tirée selon la difficulté du donjon. Cinq raretés, qui **sont cinq items distincts** du jeu (`Wooden Key`, `Stone Key`, `Iron Key`, `Gold Key`, `Diamond Key` — il n'existe pas de `Key` générique).
- **Aucune détection, aucune prédiction.** Les coffres sont dans les modèles de salles, à la main ; le code ne cherche rien et ne devine rien : `onPlayerClick` nomme le bloc cliqué, et la seule question est `bloc === "Chest"`. Un coffre posé n'importe où dans une salle fonctionne.
- **Le coffre est remplacé par de l'`Air`**, et la clé **tombe au milieu du bloc cliqué** (`x + 0.5`, `y`, `z + 0.5`). Le coffre vide est toute la mémoire de « déjà ouvert » : il n'y a plus de coffre à rouvrir, et une salle recopiée rend son coffre.
- **Le bloc est vidé avant que la clé soit créée** : si le drop échoue, la clé n'est pas dupliquée, et le joueur est prévenu (`could not be dropped`).
- **Les chances penchent vers le rare quand la difficulté monte** (tirage pondéré, chaque clé reste possible partout) :

  | Niveau | Wooden | Stone | Iron | Gold | Diamond |
  | --- | --- | --- | --- | --- | --- |
  | Very Easy | 60 % | 24 % | 10 % | 5 % | 1 % |
  | Easy | 53 % | 23 % | 12 % | 8 % | 5 % |
  | Medium | 45 % | 22 % | 13 % | 11 % | 9 % |
  | Normal | 38 % | 21 % | 15 % | 14 % | 13 % |
  | Hard | 30 % | 19 % | 17 % | 17 % | 16 % |
  | Insane | 23 % | 18 % | 19 % | 20 % | 20 % |
  | Ultra Insane | 15 % | 17 % | 20 % | 23 % | 24 % |
  | Hell | 8 % | 16 % | 22 % | 26 % | 28 % |

### Découvrir une salle : de l'aura, une fois par salle

- **Chaque salle visitée pour la première fois du run donne de l'aura** — l'XP du jeu, appliquée par `api.applyAuraChange(playerId, auraDiff)`. Message : `New room discovered: +N aura`.
- **Une seule fois par salle et par run.** Le run retient ses salles découvertes (`level.discovered`), et le run meurt avec le donjon : rejouer le même niveau repaie tout.
- **Ce que « découvrir » veut dire ici.** Le joueur **marche** dans un nouveau chunk (§ [`tick`](src/dungeon/service.js)) — pas une téléportation, pas le tick qui suit l'arrivée (`justPlaced`). Et la salle doit être **lisible** : plan posé par la sonde *et* `getBlock` non `null` à la hauteur du joueur. Payer une salle que le client n'a pas encore reçue paierait un trou.
- **La salle d'entrée est payée à l'atterrissage**, une fois, par le même chemin — le joueur y est *arrivé*, il ne l'a pas traversée.
- **Le montant dépend du niveau** : `roomAura = 10` en Very Easy, interpolé jusqu'à **20** en Hell (10, 11, 13, 14, 16, 17, 19, 20). Voir `roomAuraFor(difficulty)` dans `src/dungeon/config.js`.

### Mourir, et revenir

- **La mort renvoie au spawn, comme le bouton « Teleport to spawn ».** `onRespawnRequest` fait exactement ce que fait le clic de boutique : `setPosition` en `[10, 21, 10]`, puis `stopBuilding`. Le donjon **s'arrête** (le tick ne lit que les joueurs qui ont un donjon), les mobs sont retirés, la place est rendue. Message : `You died. Back to spawn — your dungeon stopped.`
- **Rien n'est perdu durablement** : l'aura des salles découvertes reste acquise, et un nouveau run retire des salles neuves.
- **Hors donjon, la mort est laissée au jeu.** `onRespawnRequest` rend `false` : le comportement normal de Bloxd s'applique, le code ne téléporte personne.
- **Le retour à l'entrée n'existe plus** : `resetMobs` a été retiré avec lui — plus de « Back at the entrance », plus de salle repeuplée sur place (voir § [`src/worldCode.js`](src/worldCode.js)).

## Sources et version compacte

Le code lisible est dans `src/` :

```
src/dungeon/config.js      constantes, table des difficultés
src/dungeon/templates.js   coordonnées des modèles, tirage déterministe
src/dungeon/loader.js      file, copie
src/dungeon/service.js     entrée, atterrissage, pad, rapports
src/dungeon/loot.js        coffres, clés, tirage par difficulté
src/benediction/config.js  raretés, familles, catalogue, chances, tirage
src/benediction/service.js points, réserve, offre, historique (mémoire seule)
src/benediction/presentation.js  carte, ligne de chat, tuile de boutique
src/dungeon/reward.js      noms d’items vérifiés par le build
src/utils/scheduler.js     scheduler piloté par le callback tick
src/worldCode.js           lobby, pads, /dbg
```

- `npm ci` installe le compilateur de build.
- `npm run build` régénère le fichier compact.
- `npm run watch` le régénère à chaque sauvegarde dans `src/`.
- `npm run check` vérifie que le bundle est à jour, valide les syntaxes, et refuse un bundle où `copyChunk`, `createShopItem` ou la table des modèles ont disparu au minification.
- `npm test` lance les 148 tests : moteur, configuration, et le bundle réel exécuté dans un `vm` contre un faux serveur qui applique les règles de Bloxd.

Le workflow GitHub vérifie la version générée sur les Pull Requests et resynchronise `world-code/` après un merge dans `main`.

## Limites connues

- **`chunkLoadTicks: 2`** vient d'une mesure en jeu : deux ticks après un `getBlock`, le chunk est là et accepte une copie. Si une salle n'apparaît pas, c'est le premier chiffre à augmenter — et il n'y a qu'un endroit à changer.
- **Chaque salle doit avoir son Bedrock en bas et en haut.** C'est le seul contrat, et c'est ce qui permet au moteur de charger, de reconnaître et de ne jamais recopier une salle.
- **Une salle sans Concrete du niveau suivant est un cul-de-sac.** Le code ne pose aucune plaque : il lit le bloc sous les pieds du joueur.
- **Les clés ne servent encore à rien** : elles s'empilent dans l'inventaire. La serrure viendra avec les portes verrouillées.
- **Les bénédictions ne font rien** : elles s'affichent, elles se paient avec un point, et c'est tout. Les effets sont la prochaine étape ; le catalogue est déjà écrit pour les recevoir sans toucher aux raretés ni aux chances.
- **Pas encore de minerais, de butin, ni de fin de partie.**
- **Les dix noms du bestiaire sont ceux du jeu, à sa casse près.** Six sont confirmés par la documentation Bloxd (`Draugr Zombie`, `Draugr Skeleton`, `Cave Golem`, `Draugr Knight`, `Zombie`, `Skeleton` — les deux derniers cités par l'encyclopédie, pas par la table des variations) ; `Armour Collector`, `Furnace Knight`, `Lil Knight` et `Scorpion` viennent de la liste des mobs hostiles du jeu, sans confirmation d'API. Un nom refusé ne casse rien : il est abandonné pour ce niveau, et `/dbg level` dit lequel.

## Documentation Bloxd utilisée

- [API Reference](https://bloxd.io/docs/api-reference) — `copyChunk`, `setBlock`, `getBlock`, `setPosition`, `setClientOptions`, `setClientOption`, `createShopItem`, `isNearInterrupt`
- [Callbacks](https://bloxd.io/docs/callbacks) — `onBlockStandStart`, `onBlockStandStop`, `onPlayerBoughtShopItem`, `onPlayerToggledShopMenu`, `onPlayerJoin`, `onPlayerLeave`, `onRespawnRequest`, `onPlayerClick`, `onPlayerKilledMob`, `onMobDespawned`, `tick`
- [Client Options](https://bloxd.io/docs/client-options) — `gravityMultiplier`, `middleTextUpper`
