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
| Niveaux | tous sur `Y = −1000` | une bande verticale par difficulté |
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

## Commandes de debug

| Commande | Effet |
| --- | --- |
| `/dbg` | Niveau, couche, position, chunk, salles prévues / en file / posées |
| `/dbg templates` | Tous les modèles des niveaux utilisés, avec lisible / illisible |
| `/dbg mem` | Les compteurs qui doivent rester bornés : file, plan, copies, échecs |
| `/dbg seed` | Le niveau et sa couche, en une ligne |

Une capture d'écran + `/dbg templates` suffisent à diagnostiquer une salle manquante.

## Pads de difficulté

| Bloc à poser | Difficulté | Couche |
| --- | --- | --- |
| Lime Concrete | Very Easy | −32 |
| Light Blue Concrete | Easy | −34 |
| Yellow Concrete | Medium | −36 |
| Orange Concrete | Normal | −38 |
| Red Concrete | Hard | −40 |
| Purple Concrete | Insane | −42 |
| Gray Concrete | Ultra Insane | −44 |
| Black Concrete | Hell | −46 |

Le lobby n'offre que Very Easy, Easy et Medium. Dans un donjon, c'est un bloc Concrete **de la salle** qui mène à la difficulté suivante, jusqu'à Hell : le code lit le bloc sous les pieds du joueur (`onBlockStandStart`), il ne pose rien. Construis donc la plaque du niveau suivant dans tes salles.

Chaque niveau occupe **sa propre bande verticale**, deux chunks sous la précédente : deux niveaux ne peuvent pas se rencontrer, même si un joueur marche 10 000 blocs.

Tous les textes visibles par les joueurs sont en anglais.

## Génération

- **Grille de chunks.** Les `viewChunks: 1` chunk autour de chaque joueur (3×3, soit 96 blocs de côté) sont mis en file, du plus proche au plus loin. Le joueur est toujours au milieu d'un anneau complet, donc le bord du monde bâti n'est jamais en vue.
- **Une sonde par chunk candidat.** Un `getBlock` sur le Bedrock du chunk répond à tout : pas envoyé → il est demandé et prêt **2 ticks** plus tard ; déjà bâti → on passe ; vide → il est mis en file.
- **Une copie par tick et par niveau.** La copie elle-même se fait en moins d'un tick ; elle n'est jamais doublée dans un tick.
- **Un scan toutes les 4 ticks**, borné à 8 nouvelles salles par scan. Un joueur immobile dont les salles sont faites ne coûte aucune lecture.
- **Rien n'est écrit dans un chunk.** Le moteur ne connaît que `copyChunk` et des lectures : c'est ce qui rend les salles sûres à construire à la main.
- **Une salle est reconnue par son Bedrock**, pas par un compteur : le tick suivant la copie, la sonde relit la destination et c'est le monde qui confirme. `/dbg mem` sépare les salles vues (`rooms`), celles en vol (`in flight`) et les chunks en cours de chargement.
- **Entrée.** Demande des modèles, téléportation au centre du chunk d'entrée, `chunkLoadTicks: 2`, copie de la salle d'entrée (si elle n'y est pas déjà), tirage de l'atterrissage, puis le joueur y est posé. La gravité est coupée pendant ces ticks, ce qui remplace la boîte de murs de l'ancien moteur. Un sol qui ne vient pas est réessayé `entryMaxTicks` fois, puis c'est un message — jamais un joueur dans le vide.
- **Atterrissage tiré au hasard.** Chaque entrée donne une colonne différente (deux joueurs sur la même plaque ne se croisent pas), à `landingMargin` cellules des murs, avec la hauteur du sol **de la salle qui a réellement été copiée** — pas celle du premier modèle de la liste. Les deux cases au-dessus doivent être vides, sinon un autre tirage ; après `landingDraws`, le centre de la salle. Un joueur ne peut donc pas apparaître dans un mur.

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
- `npm run check` vérifie que le bundle est à jour, valide les syntaxes, et refuse un bundle où `copyChunk` ou la table des modèles ont disparu au minification.
- `npm test` lance les 64 tests : moteur, configuration, et le bundle réel exécuté dans un `vm` contre un faux serveur qui applique les règles de Bloxd.

Le workflow GitHub vérifie la version générée sur les Pull Requests et resynchronise `world-code/` après un merge dans `main`.

## Limites connues

- **`chunkLoadTicks: 2`** vient d'une mesure en jeu : deux ticks après un `getBlock`, le chunk est là et accepte une copie. Si une salle n'apparaît pas, c'est le premier chiffre à augmenter — et il n'y a qu'un endroit à changer.
- **Chaque salle doit avoir son Bedrock en bas et en haut.** C'est le seul contrat, et c'est ce qui permet au moteur de charger, de reconnaître et de ne jamais recopier une salle.
- **Une salle sans Concrete du niveau suivant est un cul-de-sac.** Le code ne pose aucune plaque : il lit le bloc sous les pieds du joueur.
- **Pas encore de mobs, minerais, butin, ni de fin de partie.** La structure est un décor figé, rien d'autre ne dépend d'elle.

## Documentation Bloxd utilisée

- [API Reference](https://bloxd.io/docs/api-reference) — `copyChunk`, `setBlock`, `getBlock`, `setPosition`, `setClientOptions`, `isNearInterrupt`
- [Callbacks](https://bloxd.io/docs/callbacks) — `onBlockStandStart`, `onBlockStandStop`, `onPlayerJoin`, `onPlayerLeave`, `onRespawnRequest`, `tick`
- [Client Options](https://bloxd.io/docs/client-options) — `gravityMultiplier`, `middleTextUpper`
