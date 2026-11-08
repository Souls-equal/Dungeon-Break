# Phase 3 — découverte, files, priorités

**Livré.** `discovery.js`, `queues.js`, `controller.js`. Le moteur sait maintenant *qui* doit être généré, *dans quel ordre*, et *combien* par cycle — sans jamais toucher au monde. `npm test` : 119 tests verts.

## Ce que ça fait

```
tick()                      appelé par le scheduler du jeu, une fois par tick
  └─ tous les 20 ticks, un cycle :
       1. découverte  — quelles ouvertures libres sont proches, sur TOUTES les branches
       2. génération  — développer les plus urgentes, dans la limite du budget
       3. construction — remettre les salles validées au builder, budget de blocs séparé
```

Les trois étapes ont trois coûts de trois ordres de grandeur différents, donc trois files et trois budgets. Les mélanger revient à payer de la géométrie à chaque tick.

## Priorités

`class = crossing ? 0 : 1`, `priority = distance + profondeur × 40`. Un seuil à moins de 6 cellules passe devant tout le reste ; la profondeur se compte depuis la **salle du joueur**, pas depuis l'entrée, pour qu'un joueur descendu loin ne soit pas affamé par un joueur resté près du départ. L'exemple chiffré du cahier des charges est un test.

## Mesures

`npm run simulate -- --seed 7 --players 6 --ticks 4000` :

| Scénario | Salles | Cycles | Médiane | p99 | Max |
| --- | --- | --- | --- | --- | --- |
| 1 joueur qui marche | 39 | 200 | 0,02 ms | 0,76 ms | 22 ms (2ᵉ cycle) |
| 6 joueurs qui marchent | 39 | 200 | 0,03 ms | 0,9 ms | 16 ms en régime |
| 6 joueurs immobiles | 31 | 200 | 0,02 ms | 0,6 ms | 8,7 ms |

80 à 90 % du temps d'un cycle part en génération, et les pics ne concernent que les premiers cycles — ceux qui ont encore des salles à créer. Un donjon rempli coûte 0,02 ms par cycle.

## Bugs trouvés en écrivant cette phase

- **La boucle de construction s'arrêtait à mi-parcours** : le garde-fou se comparait au nombre d'éléments *restants* de la file, qui diminue à chaque tour. Le symptôme ressemblait à un builder qui ignorait des salles. Corrigé en figeant la borne avant la boucle.
- **Le budget de blocs était dépassé d'une salle.** C'était assumé puis mal évalué : une salle peut coûter bien plus que le reste du budget. La règle est maintenant explicite — le budget borne le cycle, jamais une salle en cours de construction, parce qu'une salle à moitié construite est pire qu'un tick un peu long.
- **Un verrou réentrant silencieux** : `cycle()` appelé depuis un builder aurait pu imbriquer deux cycles sur le même graphe. Il est refusé, compté, et le verrou est relâché par un `finally`.

## Ce qui n'est pas fait

La construction réelle, les pads, la protection des murs (`api.*`) : **Phase 4**. La persistance : **Phase 5**.
