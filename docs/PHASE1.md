# Phase 1 — géométrie, ouvertures, graphe

**Livré.** Moteur hors-ligne dans `src/dungeon/engine/`, utilisable sans Bloxd et sans aucune référence à `api.*` — vérifié par un test d'architecture, pas par une promesse. 59 tests, `npm test` vert. Aucune ligne du jeu en cours n'est encore branchée dessus : c'est la Phase 4.

## Ce qui existe

| Fichier | Rôle |
| --- | --- |
| `config.js` | `DUNGEON_CONFIG` (toutes les constantes nommées) et `DIFFICULTIES` (les huit niveaux, dont trois accessibles depuis le lobby) |
| `random.js` | FNV-1a + mulberry32. Aucun RNG global : une salle est une fonction pure de `(seed, salle parente, ouverture, tentative)` |
| `geometry.js` | Masques, rotations, contours, dégagements, parcours marchables, conversions de repères |
| `shapes.js` | Grammaire de formes en sept familles, avec grille d'acceptation et codes de refus |
| `openings.js` | Planification des ouvertures, placement d'une salle contre une ouverture, cellules du joint et des ponts |
| `spatialIndex.js` | Grille de régions (salles) et index d'ouvertures (boucles, raccourcis) |
| `validator.js` | Fonction pure d'acceptation, avec un code de refus pour chaque cause |
| `dungeonManager.js` | Source de vérité du graphe : `expand`, réutilisation, boucles, profondeurs, point de commit unique |

## Ce que ça produit

`node tools/visualize-dungeon.mjs --seed 12345 --rooms 150` :

| Seed | Salles | Connexions | Ponts | Boucles | Culs-de-sac | Profondeur max | Ouvertures libres |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 12345 | 150 | 155 | 4 | 6 | 57 | 8 | 264 |
| 777 | 150 | 152 | 2 | 3 | 57 | 9 | 276 |
| 2024 | 150 | 152 | 3 | 3 | 57 | 8 | 264 |
| 5150 | 150 | 154 | 5 | 5 | 51 | 8 | 268 |

Un arbre de 150 salles aurait 149 arêtes ; il y en a 152 à 155, donc de vraies boucles, et un tiers des salles sont des carrefours à trois ou quatre voisins. Les ouvertures encore libres (≈ 265) restent disponibles pour la suite de l'exploration : c'est une exigence explicite, et elle est vérifiée par un test.

Une carte complète est dans [`examples/dungeon-seed-12345.txt`](examples/dungeon-seed-12345.txt) : `#` mur, `.` sol, `o` seuil connecté, `p` seuil libre, `=` joint, `+` pont, `E` salle d'entrée.

## Tests

```bash
npm test                       # 85 tests (26 existants + 59 moteur)
npm run visualize -- --seed 12345 --rooms 150
```

Les cinq propriétés de sortie de la phase (§17.2 de `ARCHITECTURE.md`) sont vérifiées pour de vrai :

1. **aucune collision** — comparaison deux à deux de toutes les paires de salles sur 120 salles ;
2. **connexions valides** — chaque connexion nomme deux ouvertures existantes, et le donjon entier est parcouru à pied depuis l'entrée jusqu'à chaque seuil connecté ;
3. **identifiants uniques** — aucune ouverture n'appartient à deux connexions ;
4. **ouvertures cohérentes** — chaque ouverture est connectée à exactement une connexion ou reste libre ;
5. **seeds reproductibles** — même seed, même donjon, structure complète comparée ; l'ordre d'exploration ne change rien.

Plus deux tests qui valent leur pesant de bugs évités : le moteur est interdit d'appeler `Math.random` pendant un test, et l'index est comparé à une implémentation de référence en O(n²).

## Décisions prises en construisant

- **`wallGap = 3`** est la constante du joint ; trois conventions de distance ont coexisté et produisaient zéro boucle détectée. Il n'en reste qu'une, et un test recompte les cellules du joint de chaque connexion.
- **Largeur de passage uniforme** (1 cellule) : deux seuils de largeurs différentes ne peuvent jamais se raccorder. Les refus `DOOR_MISMATCH` sont passés de ~45 % à ~5 % des candidats.
- **Pas de marge de sécurité** : le joint suffit, et une marge ne faisait que refuser des salles.
- **Deux natures de connexion** : `direct` (le joint) et `bridge` (un court couloir explicite, cellules stockées). Un pont n'est jamais deviné.
- **Le refus remonté est le refus réel**, pas « tentatives épuisées » : sans cela, tout diagnostic est faux.
- **L'identité d'une salle est son chemin** (`r0.0.2` = troisième ouverture de la première ouverture de l'entrée), pas un compteur. Avec un compteur, la géométrie d'une salle dépendait de l'ordre d'exploration : la même seed donnait un donjon différent selon l'ordre des ticks. C'est corrigé, et un test reconstruit la même salle dans un petit et dans un grand donjon pour le prouver.
- **Pas d'objet de transaction** : la génération est pure et synchrone, donc il n'y a aucun état intermédiaire à nettoyer. La réservation d'ouverture ne sera introduite qu'en Phase 3, quand deux requêtes concurrentes pourront viser la même ouverture.

## Ce qui n'est pas fait, et ne l'est pas par oubli

- la découverte, les trois files, les priorités et les budgets → **Phase 3** ;
- tout `api.*`, la construction, les pads, la protection des murs → **Phase 4** ;
- la persistance, la fragmentation, la reprise → **Phase 5** ;
- le branchement dans `src/dungeon/generator.js` : l'ancien générateur tourne toujours. Le remplacer est un travail de Phase 4, et le laisser en place est ce qui garde le jeu fonctionnel entre-temps.
