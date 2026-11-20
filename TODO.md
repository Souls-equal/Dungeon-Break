# TODO — Dungeon Break

> **Référence unique pour les prochaines itérations.** Source de vérité pour prioriser jouabilité / rejouabilité / qualité / retours joueurs.
> Contraintes actuelles : **pas de lien externe (Discord) possible** — metrics uniquement via **API analytics Bloxd** interne. Tout doit rester in-game.

---

## Légende
- **Impact :** ⭐ = moyen, ⭐⭐ = fort, ⭐⭐⭐ = très fort sur rétention/reviews
- **Effort :** S = < 2 jours, M = 3-7 jours, L = 1-3 semaines
- **Métrique Bloxd :** événement à logger via `api.*Analytics*` (adapter au nom exact exposé par Bloxd — l'API existe, aucun call externe)

---

## P0 — Critique (faire en premier)

### [ ] 1. Feedback de combat immédiat
**Problème :** On ne "sent" pas les dégâts — #1 cause d'avis négatifs en PvE.
**Faire :**
- Damage numbers (couleur par set), crit flash, hitstop léger
- Son différent par type d'arme (Sword/Dagger/Staff)
- Particules déjà dispo `PRESETS`/`spawnParticles` + calcul déjà dans `onPlayerDamagingMob`
**Fichiers :** `src/combatFx/service.js`, `src/weapons/service.js`, `src/worldCode.js:onPlayerDamagingMob`
**Métrique :** `analytics.combat.hit` + `analytics.combat.kill_time_avg`
**Impact :** ⭐⭐⭐ / Effort : **S**

### [ ] 2. Preview craft + arbre de progression
**Problème :** Les crafts sont obscurs (`/dbg crafts`). 40% churn avant 1er craft.
**Faire :**
- Dans Artisan Bench : affiche arme/armure *après craft* vs équipé (dégâts/effet)
- Arbre visuel Shards → Alloy → Set (données déjà dans `CRAFTS`, `ARMOR_SETS`, `WEAPON_SETS`, `SHARD_TO_MATERIAL`)
- Tooltip "Il te manque 2x Sanguine Shard (Rare crate)"
**Fichiers :** `src/crafting/config.js`, `src/crafting/itemStats.js`, `src/crafting/service.js`, shop UI
**Métrique :** `analytics.craft.preview_open`, `analytics.craft.success_rate`, `analytics.craft.time_to_first_craft`
**Impact :** ⭐⭐⭐ / Effort : **M**

### [ ] 3. Tutoriel jouable 90s (premier join)
**Problème :** Onboarding = 2 messages. Perte massive de nouveaux joueurs Bloxd.
**Faire :**
- Couloir template : pad → coffre (clé) → caisse Rare à rouler → craft Amethite → mob à tuer → récompense Wood Sword + 1 blessing
- Flag `hasDoneTutorial` via `api.getPlayerDbValue`/`setPlayerDbValue`
- Remplace messages `onPlayerJoin` si flag absent
**Fichiers :** `src/worldCode.js:onPlayerJoin`, `src/dungeon/templates.js` (nouveau chunk)
**Métrique :** `analytics.tutorial.started`, `analytics.tutorial.completed`, `analytics.tutorial.time`
**Impact :** ⭐⭐⭐ / Effort : **M**

---

## P1 — Rejouabilité

### [ ] 4. Quêtes quotidiennes / hebdo + Pass léger (sans P2W)
**Faire :**
- 3 quotidiennes (ex: "Tue 50 mobs Very Easy", "Ouvre 3 caisses Rare", "Craft Voltplate")
- 5 hebdo + pass gratuit 20 paliers (or, shards, cosmétiques)
- Réutilise `ranks().recordKill/recordCrate` + DB `DailyQuestService` (même pattern que `UNLOCK_DB_KEY`)
**Fichiers :** nouveau `src/quests/service.js` + `src/quests/config.js`, `src/worldCode.js`
**Métrique :** `analytics.quest.daily_complete`, `analytics.quest.retention_d1/d7`, `analytics.pass.level_reached`
**Impact :** ⭐⭐⭐ / Effort : **M**

### [ ] 5. Endless + Boss Rush + Seed partageable
**Faire :**
- Après Hell : Endless (+2% dégâts/mobs par salle), Boss Rush (5 salles boss)
- Affiche seed (`/dbg seed` existe) + bouton "Copier seed" + leaderboard temps/morts
**Fichiers :** `src/dungeon/config.js` (`DIFFICULTIES`), `src/dungeon/service.js`, `src/worldCode.js`
**Métrique :** `analytics.run.endless_depth_avg`, `analytics.run.bossrush_clear_rate`, `analytics.seed.shared`
**Impact :** ⭐⭐ / Effort : **M**

### [ ] 6. Draft Blessings avec reroll + synergies
**Faire :**
- Roll affiche synergies (ex: "Sanguine + Geo = +15% shield")
- 1 reroll = 5 or (`cstm_smp_gold`)
- Limite RNG frustrante, plus de choix
**Fichiers :** `src/blessing/config.js`, `src/blessing/presentation.js`, `src/worldCode.js:rollBlessing`
**Métrique :** `analytics.blessing.pick_rate` par blessing/rarity, `analytics.blessing.reroll_rate`
**Impact :** ⭐⭐ / Effort : **S**

---

## P2 — Qualité & Vie communautaire

### [ ] 7. Coop 2-3 joueurs + rez
**Faire :**
- Pads à 2 = départ groupé, même instance, vie alliée visible, rez 5s (-50% or)
- Réutilise `service()` déjà global ("one service for the whole world")
- Garde `crateIsOwnedByOther` pour anti-vol
**Fichiers :** `src/worldCode.js:onPadStart`, `src/dungeon/service.js`, `src/crate/service.js`
**Métrique :** `analytics.coop.run_started`, `analytics.coop.rez_count`, `analytics.coop.retention_vs_solo`
**Impact :** ⭐⭐⭐ / Effort : **L**

### [ ] 8. Saisons 6 semaines (reset doux, pas full wipe)
**Faire :**
- Garde permanent (blessings permanentes, ranks), reset run/timed + or
- 1 biome reskinné par saison (tu copies déjà des chunks — change palette + mobs)
- 2 nouveaux sets / saison
**Fichiers :** `src/ranks/config.js`, `src/dungeon/templates.js`, `src/blessing/service.js:resetPlayerProgress`
**Métrique :** `analytics.season.active_players`, `analytics.season.returning_rate`
**Impact :** ⭐⭐ / Effort : **L**

### [ ] 9. Cosmétiques liés aux Ranks (éthique)
**Faire :**
- Trail particules, couleur nametag (`applyRankVisuals` déjà), titre chat, emote débloqués par rank Epic/Legendary
- Vendus en or aussi, pas de P2W
- `/rank preview`
**Fichiers :** `src/ranks/config.js`, `src/ranks/service.js`, `src/particles/config.js`
**Métrique :** `analytics.cosmetic.equip_rate`, `analytics.shop.rank_preview`
**Impact :** ⭐ / Effort : **S**

### [ ] 10. Metrics in-game + feedback natif (sans Discord)
**Faire :**
- Écran shop "Donner mon avis" : 3 emoji (😍😐😡) + champ texte court + catégorie (bug/idée/équilibrage)
- Stockage via Bloxd Analytics uniquement : `analytics.feedback.sent`, `analytics.feedback.category`
- **Dashboard interne** (pas externe) : utiliser les events Bloxd déjà dispo — *aucun webhook externe*
  - Clear rate par difficulté, temps moyen, crafts +/- populaires, pick-rate blessings, drop crates
- Patch notes in-game (panneau lobby lisant un `globalThis.PATCH_NOTES` versionné)
**Fichiers :** nouveau `src/feedback/service.js`, `src/worldCode.js` (shop category Feedback), `worldCode.js` (log analytics)
**Contrainte respectée :** **zéro call externe** — tout via API analytics Bloxd interne.
**Métrique :** `analytics.feedback.sent`, `analytics.feedback.satisfaction_avg`
**Impact :** ⭐⭐ / Effort : **S**

---

## Métriques — implémentation Bloxd

> Bloxd expose déjà une API analytics. Remplace `api.RECORD` ci-dessous par le nom exact de ton environnement (`api.recordAnalytics`, `api.logAnalytics`, `api.trackEvent`…).

```js
// Exemple wrapper unique à mettre dans src/utils/analytics.js
export function track(playerId, event, props = {}) {
  if (typeof api.recordAnalytics === "function") api.recordAnalytics(event, { playerId, ...props });
  else if (typeof api.logAnalytics === "function") api.logAnalytics(event, props);
  else api.log(`[Analytics] ${event} ${JSON.stringify(props)}`);
}
// Usage :
// track(playerId, "craft.success", { set: "Sanguine", tier: 3 });
// track(playerId, "run.clear", { difficulty: "Very Easy", timeSec: 412, deaths: 1 });
```

**Events prioritaires à logger dès maintenant :**
- `tutorial.completed`, `craft.success`, `run.clear`, `run.death`, `blessing.pick`, `quest.complete`, `crate.open`, `coop.run_started`

---

## Roadmap suggérée

- **Semaine 1 :** #1 + #3 + #10 (feedback loop)
- **Semaine 2-3 :** #2 + #6
- **Mois 2 :** #4 + #5
- **Mois 3 :** #7 (si rétention coop validée) + #8 début saison 1

---

## Comment contribuer

1. Crée une branche `arena/<id>-dungeon-break`
2. Coche `[x]` ici + ajoute test dans `tests/` si logique
3. `npm run build` → `npm test` (167 tests) → PR → merge auto autorisé (cf `AGENT_RULES.md`)

*Dernière mise à jour : 2026-02-15 — mainteneur : @Souls-equal*
