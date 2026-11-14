# Dungeon Break — Bloxd.io

Lobby de sélection de difficulté, compte à rebours individuel, puis un donjon généré **chunk par chunk** : une salle est un modèle de 32×32×32 copié d'un seul appel.

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

1. Dans ton monde Bloxd, construis les pads de difficulté avec les blocs **Concrete** ci-dessous, à l'endroit où tu veux le lobby. Le joueur doit pouvoir marcher sur leur surface.
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

Deux choses, aucune écrite dans la table :

1. **Le chunk doit être chargé** au moment de la copie : sinon `copyChunk` ne fait rien, sans erreur. `/dbg templates` répond pour chaque salle (`loaded` / `NOT LOADED`).
2. **La hauteur du sol est lue**, jamais configurée : le moteur remonte la colonne du milieu de la salle jusqu'au premier bloc plein. La copie conserve la disposition verticale de la salle, donc cette hauteur est valable à destination.

**Le générateur n'écrit jamais un bloc.** Rien ne vient du modèle non plus : aucune case de tes constructions n'est réservée, aucun témoin, aucune plaque, aucune réparation. Une salle est un chunk, et le seul geste du moteur est de le copier.

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

- **Grille de chunks.** Les `viewChunks: 2` chunks autour de chaque joueur (5×5, soit 160 blocs de côté) sont mis en file, du plus proche au plus loin.
- **Une copie par tick et par niveau.** Une copie écrit 32 768 blocs côté serveur ; elle n'est jamais doublée dans un tick.
- **Un scan toutes les 4 ticks**, borné à 8 nouvelles salles par scan. Un joueur immobile dont les salles sont faites ne coûte aucune lecture.
- **Rien n'est écrit dans un chunk.** Le moteur ne connaît que `copyChunk` et des lectures : c'est ce qui rend les salles sûres à construire à la main.
- **Une salle copiée est retenue pour la session**, puisque le monde ne peut pas être interrogé : `/dbg mem` la compte comme posée, et non vérifiée. Après un redémarrage le niveau la recopie une fois — une copie est idempotente, elle réécrit les mêmes blocs aux mêmes cases.
- **Seules les destinations chargées sont copiées** (`api.isBlockInLoadedChunk`) : une copie dans un chunk que le serveur n'a pas encore envoyé serait perdue sans erreur.
- **Entrée.** Lecture du modèle, téléportation dans le chunk vide, trois ticks, copie de la salle d'entrée, relecture du sol, puis le joueur est posé deux blocs au-dessus. La gravité est coupée pendant ces ticks, ce qui remplace la boîte de murs de l'ancien moteur.

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
- `npm test` lance les 58 tests : moteur, configuration, et le bundle réel exécuté dans un `vm` contre un faux serveur qui applique les règles de Bloxd.

Le workflow GitHub vérifie la version générée sur les Pull Requests et resynchronise `world-code/` après un merge dans `main`.

## Limites connues

- **Le coût réel d'une copie de chunk n'est pas mesuré en jeu.** 1 par tick est un choix prudent ; si un tick s'allonge, c'est `scanTicks` dans `config.js` qu'il faut augmenter d'abord.
- **`chunkWarmupTicks: 3`** vient de la mesure faite sur le moteur précédent. Si une salle d'entrée n'apparaît pas, c'est le premier chiffre à augmenter.
- **Le pad n'est posé que dans la salle d'arrivée.** Le poser dans toutes les salles visiterait 25 blocs de plus par salle ; à décider quand le coût d'une copie sera connu.
- **Pas encore de mobs, minerais, butin, ni de fin de partie.** La structure est un décor figé, rien d'autre ne dépend d'elle.

## Documentation Bloxd utilisée

- [API Reference](https://bloxd.io/docs/api-reference) — `copyChunk`, `setBlock`, `getBlock`, `setPosition`, `setClientOptions`, `isNearInterrupt`
- [Callbacks](https://bloxd.io/docs/callbacks) — `onBlockStandStart`, `onBlockStandStop`, `onPlayerJoin`, `onPlayerLeave`, `onRespawnRequest`, `tick`
- [Client Options](https://bloxd.io/docs/client-options) — `gravityMultiplier`, `middleTextUpper`
