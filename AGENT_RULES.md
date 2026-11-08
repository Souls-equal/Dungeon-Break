# Règles de travail pour Dungeon Break

Ce document rassemble les préférences de travail demandées par le propriétaire du projet. Je dois le relire au début des prochaines tâches sur ce dépôt. Il sert de référence au projet, sans remplacer les instructions de priorité supérieure ni les contraintes de la plateforme.

## Règles générales de fonctionnement

### 1. Communication et incertitudes

- En cas de doute important sur une API, une fonction, la documentation ou un comportement technique, demander directement au propriétaire du projet.
- Ne jamais supposer qu'une fonction, méthode ou propriété existe : vérifier sa disponibilité et sa signature avant de l'utiliser.
- Ne pas proposer de solution reposant sur des informations non vérifiées.
- Si plusieurs solutions sont possibles, choisir la plus fiable et expliquer brièvement ce choix.
- Ne jamais masquer une incertitude ou une erreur.

### 2. Git et Pull Requests

- Quand c'est possible dans le cadre de la tâche et des contraintes de la plateforme, créer puis merger la Pull Request dès que le travail est terminé, sans demander une autorisation intermédiaire.
- Vérifier que le code fonctionne et que les tests disponibles passent avant le merge.
- Ne jamais supprimer des modifications qui ne proviennent pas de mon travail.
- Ne jamais forcer un push ni réécrire l'historique sans autorisation.
- Respecter la branche de travail imposée par Arena et ouvrir les Pull Requests depuis cette branche.

### 3. Qualité du code

- Privilégier un code propre, lisible, maintenable et performant.
- Éviter les duplications, le code mort, les variables inutilisées et les commentaires obsolètes.
- Ne pas compliquer inutilement une solution simple.
- Respecter les conventions et l'architecture du projet.
- Préférer une modification ciblée à la réécriture d'un système entier.

### 4. Vérifications

- Avant toute modification, comprendre le fonctionnement du code concerné.
- Vérifier les dépendances et les effets secondaires potentiels.
- Après chaque modification importante, lancer les tests appropriés.
- Vérifier la syntaxe, les imports et les références.
- Ne pas considérer une tâche comme terminée sans avoir vérifié le résultat.
- Indiquer clairement ce qui n'a pas pu être testé.

### 5. Gestion des erreurs

- Ne jamais contourner une erreur sans en comprendre l'origine.
- Ne pas supprimer une fonctionnalité pour corriger un problème secondaire.
- Si une correction entraîne un nouveau problème, le résoudre avant de terminer.
- Signaler les problèmes impossibles à résoudre.

### 6. Autonomie

- Travailler de manière autonome autant que possible et ne pas demander de confirmation pour chaque petite décision technique.
- Prendre les décisions évidentes ; demander l'avis du propriétaire uniquement si une incertitude importante subsiste ou si son choix est réellement nécessaire.
- Ne jamais prétendre qu'une tâche est terminée si elle ne l'est que partiellement.

## Règles spécifiques à Bloxd.io

- La documentation officielle de [Bloxd.io](https://bloxd.io/docs) est la référence prioritaire pour son API.
- Ne jamais supposer qu'une API JavaScript classique est disponible dans l'environnement Bloxd.io.
- Vérifier systématiquement la disponibilité et la signature des fonctions utilisées.
- Respecter les contraintes propres à Code Loader et au contexte d'exécution ciblé.
- Ne pas utiliser `await` dans le code destiné à Bloxd.io.
- Ne pas utiliser directement `setTimeout`, `setInterval` ou d'autres fonctions natives sans avoir vérifié qu'elles sont disponibles. Utiliser le système de scheduling documenté ou déjà présent dans le projet.
- Respecter strictement le nombre et l'ordre des arguments des fonctions API.
- Comprendre les interactions avant de modifier les systèmes existants et privilégier les fonctions utilitaires déjà présentes.
- Ne jamais remplacer une API indisponible par une fonction fictive.
- En cas de doute sur une mécanique du jeu qui ne peut pas être levé par la documentation, demander au propriétaire avant de l'implémenter.
