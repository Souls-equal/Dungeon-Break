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

Tout est dans [`src/dungeon/templates.js`](src/dungeon/templates.js) :

```js
globalThis.ROOM_TEMPLATES = {
  veryEasy: [
    { id: "hall-a", src: [0, -32, 0], faces: "NESW" },
    { id: "hall-b", src: [32, -32, 0], faces: "NESW" },
    { id: "corner-a", src: [64, -32, 0], faces: "NE" },
  ],
  easy: [ /* ... */ ],
};
```

- **`src`** : `[x, y, z]` d'un bloc **dans** le chunk modèle. Le générateur copie le chunk entier, donc un coin est la coordonnée la plus claire. Le `y` doit être dans le chunk aussi : `[0, -32, 0]` et `[5, -20, 7]` désignent le même chunk.
- **`faces`** : les côtés qui ont une porte, dans l'ordre **N, E, S, W**. `"NESW"` : quatre portes. `"NS"` : un couloir nord–sud. Deux chunks voisins se raccordent quand leurs deux faces ont une porte.
- **`spawn: true`** : le modèle utilisé pour la salle d'entrée (facultatif — sinon le tirage décide).
- **`markerLocal`** : `[x, y, z]` local du bloc-témoin, si le coin bas `(0, 0, 0)` n'est pas plein.

Trois contraintes, et deux seulement :

1. **Les portes doivent tomber sur les mêmes cases de part et d'autre.** Deux chunks se touchent, sans couloir entre eux : une porte en `x 13..18` sur la face nord du chunk `(0,0)` doit correspondre à `x 13..18` sur la face sud du chunk `(0,−1)`. Le plus simple : la même porte au même endroit sur tous les modèles.
2. **Le coin bas du chunk doit être plein** (c'est là que vit le bloc-témoin `Bedrock`), ou donne un `markerLocal`.
3. **Le sol du modèle est lu, pas configuré** : le code remonte la colonne du centre jusqu'au premier bloc plein, et pose le joueur deux blocs au-dessus.

Après avoir modifié `src/`, `npm run build` régénère `world-code/worldCode.js`. Ne modifie jamais le fichier généré.

### Vérifier que les modèles sont lisibles en jeu

`copyChunk` **ne fait rien si le chunk source n'est pas chargé**, et ne le dit pas. En jeu, tape `/dbg templates` :

```
[dbg] Very Easy · hall-a [0, -32, 0] faces NESW · loaded
[dbg] Very Easy · hall-b [32, -32, 0] faces NESW · NOT LOADED
```

`NOT LOADED` veut dire que le serveur n'a pas envoyé ce chunk : la coordonnée est mauvaise, ou la zone des modèles n'est pas chargée par le monde. C'est le premier endroit à regarder quand un niveau s'ouvre sur du vide.

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

Le lobby n'offre que Very Easy, Easy et Medium. Dans un donjon, le pad posé au centre de la salle mène à la difficulté suivante, jusqu'à Hell.

Chaque niveau occupe **sa propre bande verticale**, deux chunks sous la précédente : deux niveaux ne peuvent pas se rencontrer, même si un joueur marche 10 000 blocs.

Tous les textes visibles par les joueurs sont en anglais.

## Génération

- **Grille de chunks.** Les `viewChunks: 2` chunks autour de chaque joueur (5×5, soit 160 blocs de côté) sont mis en file, du plus proche au plus loin.
- **Une copie par tick et par niveau.** Une copie écrit 32 768 blocs côté serveur ; elle n'est jamais doublée dans un tick.
- **Un scan toutes les 4 ticks**, borné à 8 nouvelles salles par scan. Un joueur immobile dont les salles sont faites ne coûte aucune lecture.
- **Un chunk déjà bâti est reconnu par un bloc-témoin** (`Bedrock`, au coin du chunk modèle) : rien n'est reconstruit au retour, et un serveur redémarré retrouve ce qu'il avait posé.
- **Une copie est vérifiée** en relisant le bloc-témoin à la destination. Le seul cas indécidable est un chunk que personne n'a chargé : il est compté comme posé-non-vérifié, et `/dbg mem` le dit.
- **Entrée.** Lecture du modèle, téléportation dans le chunk vide, trois ticks, copie de la salle d'entrée, relecture du sol, puis le joueur est posé deux blocs au-dessus. La gravité est coupée pendant ces ticks, ce qui remplace la boîte de murs de l'ancien moteur.

## Sources et version compacte

Le code lisible est dans `src/` :

```
src/dungeon/config.js      constantes, table des difficultés
src/dungeon/templates.js   coordonnées des modèles, tirage déterministe
src/dungeon/loader.js      file, copie, vérification
src/dungeon/service.js     entrée, atterrissage, pad, rapports
src/utils/scheduler.js     scheduler piloté par le callback tick
src/worldCode.js           lobby, pads, /dbg
```

- `npm ci` installe le compilateur de build.
- `npm run build` régénère le fichier compact.
- `npm run watch` le régénère à chaque sauvegarde dans `src/`.
- `npm run check` vérifie que le bundle est à jour, valide les syntaxes, et refuse un bundle où `copyChunk` ou la table des modèles ont disparu au minification.
- `npm test` lance les 50 tests : moteur, configuration, et le bundle réel exécuté dans un `vm` contre un faux serveur qui applique les règles de Bloxd.

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
