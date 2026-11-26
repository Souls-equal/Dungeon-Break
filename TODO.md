# TODO — Dungeon Break

> **Référence unique pour les prochaines itérations.** Source de vérité pour prioriser jouabilité / rejouabilité / qualité / retours joueurs.
> Contraintes actuelles : **pas de lien externe (Discord) possible** — metrics uniquement via **API analytics Bloxd** interne. Tout doit rester in-game. Langue joueur : **Anglais 100%**.

---

## Légende
- **Impact :** ⭐ = moyen, ⭐⭐ = fort, ⭐⭐⭐ = très fort sur rétention/reviews
- **Effort :** S = < 2 jours, M = 3-7 jours, L = 1-3 semaines
- **Risque :** 🟢 safe, 🟡 touche économie/balance, 🔴 touche progression persistante
- **Métrique Bloxd :** événement via `src/utils/analytics.js` → `api.registerAnalyticsEvent` (API vérifiée, Custom games only, aucun call externe, limites 20 evt/min/player)
- **DoD = Definition of Done :** critères objectifs pour cocher `[x]`

---

## 🔴 P0 — Critique (faire en premier)

### [x] 1. Feedback de combat immédiat — fait (complément Bloxd natif)
**Fait :** damage numbers couleur set, flying text `+burn/poison/shield` via `onPlayerDamagingMob` + `api.sendFlyingMiddleMessage`, son optionnel par set `api.playSound` si dispo. Bloxd natif garde hit sound/crit particles/flash rouge — on ne duplique pas.
**Fichiers :** `src/combatFx/service.js`, `src/weapons/service.js`
**Métrique :** `analytics.combat.hit` + `analytics.combat.kill_time_avg`
**Impact :** ⭐⭐⭐ / Effort : **S** / Risque 🟢

### [x] 2. Preview craft + arbre de progression — réorg stations (2/2 done)
**Fait :** stations réorganisées — Workbench = armes (épées/etc.), Artisan Bench = armures, Inventaire (`station: ""`) = matériaux (shards→lingots). Clarifie progression vs TODO initial (preview UI reste TODO futur → voir #23).
**Fichiers :** `src/crafting/config.js`, `src/crafting/vanilla.js`, `src/crafting/itemStats.js`, `src/crafting/service.js`, shop UI
**Métrique :** `analytics.craft.preview_open`, `analytics.craft.success_rate`, `analytics.craft.time_to_first_craft`
**Impact :** ⭐⭐⭐ / Effort : **M** / Risque 🟢

### [x] 3. Tutoriel jouable 90s (premier join) — FAIT
**Fait depuis février :** implémenté dans `src/tutorial/service.js` — 3 étapes natives :
- Join → `Wooden Key` donnée + flèche rouge `groundArrowPath` vers caisse `[31.5,20,-0.5]` + highlight hotbar du slot clé
- `generateChest()` → "collect the loot" + remove highlight
- Flèche verte vers donjon `[2.5,20,-7.5]`
- Flag persistant `hasDoneTutorial` via `api.get/setPlayerDbValue` (`t:1`, compat legacy `dungeonBreak.tutorial.v1` + `tutorial.step` → `done`). Remplace les 2 messages `onPlayerJoin` si flag absent.
**Limite :** pas de couloir template dédié ni `Wood Sword + 1 blessing` en récompense, pas de "tuer un mob" guidé → voir **#24 Amélioration tuto**.
**Fichiers :** `src/tutorial/service.js`, `src/worldCode.js:onPlayerJoin` / `onTutorial*` / `tickTutorialHighlight`
**Métrique :** `analytics.tutorial.started`, `analytics.tutorial.completed`, `analytics.tutorial.time`
**Impact :** ⭐⭐⭐ / Effort : **M** → **fait**

### [x] 3b. Spawns mobs fiables — fait (2026-11-23)
**Fait :** cap global 64 → bannissait tout le bestiaire + salles à 0 marquées `populated`. Fix `src/dungeon/loader.js` : `successfulMobTypes`, ban seulement si salle pleine, retry si 0.
**Fichiers :** `src/dungeon/loader.js`, `src/dungeon/service.js`
**Métrique :** `analytics.dungeon.mobs_per_room`, `analytics.dungeon.empty_room_rate`
**Impact :** ⭐⭐⭐ / Effort : **S** → **fait** — 167/167 tests

### [x] 3c. Crates "au minimum leur crate" — fait (2026-11-23)
**Fait :** `Wood→Common` (bois/armes bois), `Stone→Uncommon` (stone + Amethite/Magmasteel/Rubellite/Serpentite), `Iron→Rare`, `Gold→Epic`, `Diamond→Legendary`; `Cotton/Arrow/Coal` only Common, `Apple/Bread` partout; Serpentite groupé avec les 3 précédents.
**Fichiers :** `src/crate/config.js`
**Métrique :** `analytics.crate.open_rate` par rareté, `analytics.crate.progression_drop`
**Impact :** ⭐⭐ / Effort : **S** → **fait**

### [x] 3d. Salles chest + Finish Block 5s + coin blockData identity — fait (2026-11-26)
**Fait :** 
- 3 salles taguées `kind:"chest"` d'après coords bloc → chunk : `-49,41,16→[-2,1,0]`, `-356,50,9→[-12,1,0]`, `-953,40,15→[-30,1,0]` via `templates.js` format étendu `[-2,1,0,"chest"]` ou `{kind,eventId}`.
- Nouvelle salle `[-40,1,0]` (et `[-38,1,0]` pour garder pas de 2 chunks) avec `Finish Block` → `kind:"finish"` (20 rooms totales).
- Coin `[0,0,0]` porte `{kind,eventId,templateIndex}` via `setBlockData` après `copyChunk`, lu via `getBlockData` (`src/dungeon/loader.js:stampRoomInfo/getRoomData`). Plus de particule générique trompeuse.
- `src/dungeon/events.js` exemple `lavaTrap` (damage 3 / 10 ticks, `onRoomEventEnter` + `tickRoomEvents`) démonstration extensible.
- **Finish Block (2026-11-26 fix FR) :** hold 5s comme pads lobby (`FINISH_HOLD_SECONDS=5`), countdown `middleTextUpper` + lower `"Stay on Finish Block to return to spawn"`, particules `padRing/padTick` dorées, debounce + final-tick 1s grace. Message unique Anglais `"Run finished! +X [Gold Coin icon]"`, `endRun("")` sans doublon. Cleanup sur leave/mort/bouton spawn. Pity : si team, tous TP (voir #21 à généraliser).
**Fichiers :** `src/dungeon/templates.js` (20 rooms), `src/dungeon/config.js:roomDataCell`, `src/dungeon/loader.js`, `src/dungeon/service.js:getRoomData`, `src/dungeon/events.js` (NEW), `src/worldCode.js:onBlockStandStart/Stop`, `src/utils/analytics.js:dungeonLeave`
**Métrique :** `analytics.dungeon.leave` (4 moyens : Leave/Finish/Button/Death), `analytics.dungeon.finish_rate`, `analytics.dungeon.finish_hold_cancel_rate`
**Impact :** ⭐⭐⭐ / Effort : **M** → **fait** — 167/167 pass, build 336k

### [x] 3e. Analytics minimal viable — fait (2026-11-26)
**Fait :** réduit à 4 events pour limite journalière Bloxd (20/j) : `combat/kill`, `tutorial/crate_opened`, `tutorial/complete`, `dungeon/leave` (tous moyens via `service.leave/teleportToSpawn`). Supprime 10+ events bruit. Wrapper `track()` + `Analytics.*` + `trackPos`.
**Fichiers :** `src/utils/analytics.js`, `src/dungeon/service.js`, `src/worldCode.js`
**Impact :** ⭐⭐⭐ / Effort : **S** / Risque 🟢

---

## 🟠 P1 — Rejouabilité (à faire — détaillé)

### [x] 4. Quêtes quotidiennes + Pass léger (sans P2W) — QUOTIDIENNES + PASS FAITS, HEBDO MANQUANT
**Fait :**
- **Quêtes quotidiennes :** NPC `Quest` en `[5.5,21,4.5]`, rotation quotidienne UTC via `pickTemplateForToday()` + `scaledTarget()` (power 0..8 basé sur gold/aura/equip). **19 templates** sur **8 types** : `kill`, `crate`, `crate_rarity` (Common 8 → Legendary 1, moins demandé si rare), `walk` (500/2000 blocks), `damage_dealt` (1000/5000), `damage_taken` (500/2000), `dungeon_enter`, `room_discover`, `time_played`. Sidebar `RightInfoText` + récompenses gold/aura + **Pass XP aléatoire** `x±100` où `x=passXpBase+power*20`.
- **Pass :** 20 paliers, 500 XP/palier = 10 000 total, `dungeonBreak.pass.v1`, XP via quêtes (`addPassXp`), shop catégorie `Pass` (tuile Reward + Info sans image), récompenses gold/items/aura. Reste gratuit, pas de P2W.
**Manque :** spec demandait **5 hebdo** → voir #11.
**Fichiers :** `src/quest/config.js` (19 templates, `QUEST_TEMPLATES`, `powerScore`), `src/quest/service.js` (NPC + sidebar + `onQuest*`), `src/pass/config.js` (`PASS_TIERS`, `rollQuestPassXp`), `src/pass/service.js`, `src/worldCode.js` (hooks `onQuest*` + `crateGenerateChest` + damage/walk)
**Métrique :** `analytics.quest.daily_complete`, `analytics.quest.retention_d1/d7`, `analytics.pass.level_reached`
**Impact :** ⭐⭐⭐ / Effort : **M** → **fait à 80%**

> **DÉTAIL — Ce qui reste à faire pour #4 :**
> - **4a. UI quêtes plus lisible :** badge `Daily 1/1 ✓` en shop + notification `Quest complete! +300 gold` avec icon, pas seulement sidebar.
> - **4b. Reroll quotidien :** 1 reroll gratuit/jour (`/quest reroll` ou shop tile) → évite quête bloquante `damage_taken 2000` pour joueur tanky.
> - **4c. Pass saisonnier :** lier Pass à saison (voir #8) pour reset doux — actuellement Pass infini = pas d'urgence.
> **DoD #4 complet :** 19 templates + 5 hebdo (#11) + reroll + notif claire + 20 paliers réclamables sans bug.

---

### [x] 5. Endless + Boss Rush
**Fait (Endless) :**
- **Endless** : débloqué après Hell via **White Concrete** (`DIFFICULTIES` +1 : `endless`, `White Concrete`, `fromLobby:false`). Base = Hell (8 mobs, 8.0× HP, 5.5× dmg), puis **+2% dégâts & mobs & XP par salle** (linéaire `1+0.02*depth`, cap 20 mobs). `mobTuningFor(difficulty, depth)`, `roomAuraFor`/`mobAuraFor` avec `ENDLESS_SCALING=0.02` et `endlessDepth` stocké sur `levelState` (`discovered.size-1`). XP salle `20 → 20*(1+0.02*depth)`, XP mob `12 → 12*(1+0.02*depth)`.
- **Boss Rush :** reste à faire.
- **Seed partageable retiré** : volontairement abandonné — `/dbg seed` reste debug seul.

> **DÉTAIL — #5 Boss Rush : ce qu'on va livrer**
> **Concept :** 5 salles d'arène consécutives, 1 boss par salle, pas de mobs trash. Entrée via `Black Concrete` en Hell (ou `White Concrete` en Endless depth 10). Chaque boss = 1 mob existant sur-statté + pattern simple.
> **Design concret :**
> - **Boss 1 - Furnace Knight Titan** (HP ×10, dmg ×2, speed 0.8) : laisse traînée de feu (recyclage `lavaTrap` → `bossFireTrail`).
> - **Boss 2 - Scorpion Swarmqueen** (HP ×8) : spawn adds `Scorpion ×3` toutes les 15s.
> - **Boss 3 - Draugr Knight Doppelganger** (clone joueur speed) : téléporte sur joueur si distance > 15 blocs.
> - **Boss 4 - Cave Golem Colossus** (HP ×15, speed 0.5) : slam AoE 5 blocs (vérif `getPosition` + `applyHealthChange -10` si dans zone).
> - **Boss 5 - Armour Collector Final** (HP ×12, dmg ×3) : vole 1 item au hasard à mi-vie (drop au sol).
> - Récompense : `5 000 gold + Diamond Key + Aura 100` + titre chat `Boss Slayer` (rank temporaire).
> **Technique :**
> - Nouveaux templates `[-42,1,0]` à `[-50,1,0]` tagués `kind:"boss", eventId:"boss1"..` — arènes plates 20×20 avec Bedrock + 4 piliers.
> - `src/dungeon/events.js:boss1..boss5` avec `onEnter` (spawn boss unique), `onTick` (pattern), `onBossDeath` (porte `Iron Door` → `Air` + message `Boss 1/5 down!`).
> - `src/dungeon/service.js:enterBossRush()` — check `hasClearedHell` (DB flag) + TP.
> - Pas de `copyChunk` supplémentaire en arène : 1 boss = 1 mob, donc cap mobs OK.
> **Balance :** durée 12-15 min, taux de clear cible 8% (hardcore), retry gratuit.
> **DoD #5 :** 5 arènes jouables + 5 patterns + récompense + `analytics.bossrush.enter/clear/floor_reached` + `/dbg bossrush` + 4 tests (spawn, pattern, reward, anti-duplicate).
> **Fichiers :** `src/dungeon/config.js` (DIFFICULTY_BOSSRUSH), `src/dungeon/templates.js` (+5), `src/dungeon/events.js` (+5 bosses), `src/dungeon/service.js`, `src/particles/config.js` (boss HP bar via middleText)
> **Métrique :** `analytics.bossrush.clear_rate`, `analytics.bossrush.avg_time`, `analytics.bossrush.wipe_floor`
> **Impact :** ⭐⭐ / Effort : **M** → **Endless fait, Boss Rush TODO**

**Fichiers Endless :** `src/dungeon/config.js` (`DIFFICULTIES`, `ENDLESS_SCALING`, `endlessFactor`, `roomAuraFor`/`mobAuraFor`/`mobTuningFor`), `src/dungeon/loader.js` (`endlessDepth`, `spawnRoomMobs` scaling), `src/dungeon/service.js` (`discoverRoom` aura scaling), `src/worldCode.js` (mob kill XP scaling), `src/particles/config.js` (`DIFFICULTY_COLOR.endless`)
**Métrique :** `analytics.run.endless_depth_avg`, `analytics.run.bossrush_clear_rate`
**Impact :** ⭐⭐ / Effort : **M** → **Endless fait, Boss Rush TODO**

---

### [~] 6. Draft Blessings avec reroll + synergies — REROLL FAIT, SYNERGIES MANQUANTES
**Fait :**
- `rollBlessing()` → 3 choix distincts, tirage pondéré par rareté, réserve 1 point, `resetShopItemForPlayer` pour retirer
- **Reroll payant ajouté (PR #159-160) :** nouveau tile `Reroll Blessings` (Blessings, icône Compass, prio 20), `REROLL_BASE_GOLD=50` + `15/blessing pris` → **très abordable** (0 pris=50g, 5 pris=125g, 10 pris=200g, 20 pris=350g). `rerollOffer()` en `src/blessing/service.js` remplace les 3 choix sans dépenser de point, coût gold via `cstm_smp_gold`. Spawn guard + `/dbg blessings` affiche `reroll cost`.

> **DÉTAIL — #6 Synergies : ce qu'on va livrer**
> **Problème :** 62 blessings isolées = pas de build, pas de "oh Sanguine + Geo = OP". Le joueur pick au hasard = pas de stratégie.
> **Solution :** 8 synergies détectées automatiquement, affichées en vert sur la carte + bonus passif.
> **Règles (simples, lisibles) :**
> | Synergie | Condition | Bonus | Texte carte |
> |---|---|---|---|
> | `Sanguine Core` | `Sanguine Blessing` + `Geo Blessing` | +15% shield (maxHealth shield) | `Synergy: Sanguine+Geo +15% shield` |
> | `Stormforged` | 2× `Voltite` blessings | +20% dealingDamage, -5% speed | `Stormforged: +20% DMG` |
> | `Iron Will` | 3× `Tank` family (Physical) | +10% receivingDamage reduction (floor 0.5) | `Iron Will: -10% DMG taken` |
> | `Glass Cannon` | 2× `Epic+` Damage + 0× `Tank` | +30% DMG dealt, -15% HP | `Glass Cannon: +30% DMG` |
> | `Lifebloom` | `Regen` + `Poison` blessings | Regen +50% | `Lifebloom: +50% regen` |
> | `Shadow Veil` | `Spectral` + `Comet` | +15% speed, +10% dodge (si trait dodge existe) | `Shadow Veil: swift` |
> | `Astral Echo` | 2× `Astral` | Timed duration +20% | `Astral Echo: +20% duration` |
> | `Anvil Blessing` | `Magmasteel` + `Serpentite` | Craft cost -10% (future #13) | `Anvil: -10% craft cost` |
> **UX :**
> - Carte blessings affiche en vert `Synergy active: X` si condition remplie, sinon grisé `Synergy: need Geo`.
> - `/dbg blessings` liste synergies actives/inactives.
> - `analytics.blessing.synergy_triggered` {synergyId}.
> **Technique :**
> - `src/blessing/config.js:SYNERGIES = [{id, need:[blessingId...], bonus, desc}]` (8 entrées).
> - `src/blessing/service.js:getActiveSynergies(playerId)` → compte `run+permanent` + `timed` ; `src/blessing/effects.js:synergyEffectsOf(ids)` → `optionsFrom` additionnel (ex: maxHealth +15%).
> - Pas de DB : synergie recalculée à chaque `applyBlessingOptions` (comme les options run/permanent).
> - 4 tests : détection 2 pièces, 3 pièces, pas de faux positif, bonus appliqué.
> **Équilibrage :** bonus +10-15% max, jamais P2W, jamais stackable 2× même synergie.
> **DoD #6 complet :** 8 synergies + affichage vert/grisé + `/dbg` + 4 tests + analytics + Effets recalculés.
> **Fichiers :** `src/blessing/config.js` (SYNERGIES), `src/blessing/service.js` (getActiveSynergies), `src/blessing/effects.js` (synergy bonus), `src/blessing/presentation.js` (synergy line), `src/worldCode.js` (annonce)
> **Métrique :** `analytics.blessing.synergy_rate`, `analytics.blessing.pick_rate` post-synergy (diversité)
> **Impact :** ⭐⭐⭐ / Effort : **S** — **très recommandé, 1-2j, fait passer blessings de "loterie" à "build"**

**Fichiers actuels :** `src/blessing/config.js` (`REROLL_BASE_GOLD`, `rerollGoldCost`, `CHOICE_COUNT`, `RARITIES`), `src/blessing/presentation.js` (`choiceTile`), `src/blessing/service.js` (`roll`, `choose`, `rerollOffer`), `src/worldCode.js:rollBlessing/rerollBlessing/refreshBlessingTiles`
**Métrique :** `analytics.blessing.pick_rate` par blessing/rarity, `analytics.blessing.reroll_rate`, `analytics.blessing.synergy_triggered`
**Impact :** ⭐⭐ / Effort : **S** → **fait à 70%, synergies = 30% restant**

---

### [ ] 11. Quêtes hebdo + Affixes hebdomadaires
> **DÉTAIL — #11 : design complet**
> **Quêtes hebdo :**
> - **Contenu :** 5 quêtes simultanées, reset **lundi 00:00 UTC**. Difficulté = quotidien ×5. Ex: `kill 250 Mobs`, `open 25 crates`, `discover 50 rooms`, `deal 25k damage`, `finish 3 dungeons (any difficulty)`.
> - **Templates :** `src/quest/config.js:WEEKLY_TEMPLATES = [{id:"weekly_kill", type:"kill", target:250, reward:{gold:1500, aura:50, passXp:300}}, ...]` (8 templates, tirage 5 aléatoires/semaine via `seed = weekNumber`).
> - **Récompenses :** ×3 quotidien + **1 Gold Key garanti** si 5/5 complétées (bonus chest). Total hebdo = ~7 500 gold + 250 aura + 1 500 Pass XP = 3 paliers Pass.
> - **DB :** `dungeonBreak.quest.weekly.v1 = {week: 2026-W48, quests:[{id, progress, done}], claimed:Boolean}`. Migration auto si week change.
> - **UI :** NPC Quest affiche 2 onglets `Daily` / `Weekly` (chat pagination ou 2 NPCs côte à côte). Sidebar `RightInfoText` ligne `Weekly 2/5`. Shop `Quests` tuiles séparées.
> **Affixe hebdomadaire :**
> - **Rotation :** même seed `weekNumber` → 1 affixe parmi 6 :
>   | Affixe | Effet | Couleur lobby |
>   |---|---|---|
>   | `Volatile` | mobs +30% dmg, -20% HP | Rouge |
>   | `Greedy` | +50% gold (mobs + Finish) | Or |
>   | `Glass` | +100% dmg dealt & taken | Blanc |
>   | `Swarm` | +50% mob count, -20% HP per mob | Vert |
>   | `Tanky` | mobs +100% HP, -20% dmg | Bleu |
>   | `Swift` | +30% mob speed, +15% player speed | Jaune |
> - **Technique :** `src/dungeon/config.js:WEEKLY_AFFIXES = {greedy:{goldMult:1.5}, ...}` ; `mobTuningFor()` applique `affixMod` ; `FINISH_REWARDS` × `goldMult` ; lobby bannière `middleTextLower` `"Weekly Affix: Greedy +50% gold"`.
> - **Contenu sans map :** 1 affixe = rejouabilité gratuite, speedrunners adorent `Glass`/`Swift`.
> **Tests :** 3 tests hebdo (pick 5, reset lundi, reward), 2 tests affixe (goldMult, mobMult).
> **DoD :** 5 hebdo + 6 affixes + UI Daily/Weekly + DB weekly + affixe appliqué en jeu + 5 tests + analytics.
> **Fichiers :** `src/quest/config.js` (WEEKLY_TEMPLATES), `src/quest/service.js` (pickWeekly, weeklyTick, affix), `src/dungeon/config.js` (WEEKLY_AFFIXES), `src/worldCode.js` (HUD affixe + hooks)
> **Métrique :** `analytics.quest.weekly_complete` (1/5, 5/5), `analytics.quest.weekly_claimed`, `analytics.affix.weekly_pick_rate` {affixId}, `analytics.retention.w7` (joueurs avec hebdo)
> **Impact :** ⭐⭐⭐ / Effort : **M** (3-5j) — **prioritaire après #4, débloque rétention week-end**
> **Risque :** 🟡 balance gold — x3 récompense doit rester < 10% inflation (calcul : hebdo 7.5k vs quotidien 2.5k×7=17.5k → hebdo = 30% bonus = OK)

---

### [ ] 12. Pity & Duplication clean pour crates
> **DÉTAIL — #12 : design complet**
> **Problème chiffré :** `AIR_CHANCE` Common 45% + doublon arme/armure → `Air` = 55% de "crate vide" ressentie. Reviews Bloxd : #1 plainte = "j'ouvre et j'ai rien".
> **Pity :**
> - **DB :** `dungeonBreak.crate.pity.v1 = {common:0, uncommon:0, rare:0, epic:0, legendary:0}` (compteur par rareté ouverte, pas par item).
> - **Règle :** +1 par crate ouverte sans item `Epic+` ; à **25** → force 1 item `Legendary` aléatoire (même table `LOOT_TABLE` filtrée `rarity: Legendary`) + reset compteur + message `"PITY! Legendary guaranteed!"` + particule `crateFountain Legendary`.
> - **Tooltip :** shop crate tuile `Pity 12/25` en lore, `/crate pity` commande affiche tous compteurs.
> - **Toxicité évitée :** pity par rareté crate, pas global → ouvrir Wood ne pity pas Diamond.
> **Duplication :**
> - **Détection :** `hasDuplicate(playerId, itemName)` → `api.getItemSlot` scan 60 slots + `getHeldItem`.
> - **Remplacement :** si doublon arme/armure → pas `Air` mais `Iron Fragment × (5 + tier*2)` (tier 1 Wood=7, tier 8 Hell=21) + message `"Duplicate → +11 Iron Fragment"` + son. Consommable/matos jamais dupliqué (stack).
> - **Alternative :** si inventaire plein et doublon → fragments direct en `giveItem` overflow = drop au sol, jamais perdu.
> **Économie :** pity 25 = 4% Legendary garanti, vs 1% natif Common → +3% Legendary global = acceptable (sink gold via #13 compense).
> **Tests :** 4 tests pity (inc, trigger 25, reset, per-rarity), 3 tests dupe (detect, fragment amount, not for consumable).
> **DoD :** pity 25 + tooltip + dupe→fragments + 7 tests + analytics + `/crate pity`.
> **Fichiers :** `src/crate/config.js` (`PITY_THRESHOLD=25`, `FRAGMENT_PER_DUPE`), `src/crate/service.js` (`rollWithPity`, `getAmountForItem`, `checkDuplicate`), `src/worldCode.js` (tooltip)
> **Métrique :** `analytics.crate.pity_triggered`, `analytics.crate.pity_counter` (valeur), `analytics.crate.dupe_converted`, `analytics.crate.air_rate_observed` (doit baisser 45%→35%)
> **Impact :** ⭐⭐⭐ / Effort : **S** (1-2j) — **top 3 plaintes, ROI max**
> **Risque :** 🟡 économie — calibrer fragments pour pas duper l'économie (soft cap 100 fragments/j via pity)

---

### [ ] 13. Enchant / Reforge léger
> **DÉTAIL — #13 : design complet**
> **Concept :** sink gold le plus demandé, sans P2W. Pas de nouvelle arme, juste relancer 1 stat d'une arme/armure existante.
> **Station :** `Anvil` à côté de `Artisan Bench` en spawn `[8,21,12]` (1 bloc `Anvil` + panneau). Shop catégorie `Reforge` (si Bloxd shop peut filtrer par station, sinon `Utilities` sub-tile).
> **Recette :**
> - Input : 1 arme/armure (n'importe quel tier, dans hotbar) + **3 fragments du tier** (ex: `Amethite Fragment ×3` pour Amethite Sword) + gold `100 × tier` (tier 1=100g, tier 8=800g).
> - Action : `Reforge` → relance **1 stat aléatoire** parmi `itemStats` (ex: `+2% crit → +4% crit` ou `+10 HP → +14 HP`), les autres stats restent. Range = ±30% de la valeur de base (jamais pire que -20%).
> - Limite : **3 reforges max / item** (`itemData.reforgeCount`, persisté via `api.setItemSlot` `attributes` ou `itemData` si dispo). 4e → message `"Max reforges (3) — craft a new one"`.
> - Coût progressif : 1er 100×tier, 2e 200×tier, 3e 400×tier → sink gold exponentiel doux.
> **Technique :**
> - `src/crafting/config.js:REFORGE_RECIPES = [{tier, fragment, baseGold}]` (8 tiers).
> - `src/crafting/service.js:reforgeItem(playerId, slotIndex)` → `api.getItemSlot` → check fragments `api.getItemSlot` → `consumeKey` like crate → `rollReforgedStat(oldStat)` → `api.setItemSlot(slot, newName, 1, {reforgeCount+1, stats})` + `giveGold(-cost)`.
> - Bloxd API `setItemSlot` `attributes` peut stocker `reforgeCount` ? Si non, fallback `api.setPlayerDbValue` `dungeonBreak.reforge.v1 = {itemUid: count}` (uid = hash name+slot+time).
> - Particules `anvilUse` + son `anvil` si dispo.
> **Balance :** reforge +30% max = pas de power creep, juste sink gold + sentiment "je peux améliorer mon arme préférée". 3 max évite reroll infini.
> **Tests :** 3 tests (cost tier, limit 3, stat in range), 1 test shop tile.
> **DoD :** station Anvil + 8 recettes + limit 3 + coût progressif + particules + 4 tests + analytics + `/reforge` help.
> **Fichiers :** `src/crafting/config.js` (REFORGE_RECIPES), `src/crafting/service.js` (reforgeItem), `src/crafting/itemStats.js` (rollReforgedStat), `src/utils/analytics.js` (craft.reforge), `src/worldCode.js` (shop)
> **Métrique :** `analytics.craft.reforge_count` {tier, attempt}, `analytics.craft.reforge_gold_sink`, `analytics.economy.gold_sink_total`
> **Impact :** ⭐⭐ / Effort : **M** (3-5j) — **sink gold #1 demandé**
> **Risque :** 🟡 économie + persistance item — fallback DB si `itemData` non persistant

---

## 🆕 P1 — Propositions 2026-11-26 (améliorations à fort ROI)

> Ces 8 ajouts exploitent ce qui vient d'être livré (coin `blockData` + Finish Block 5s + `dungeon/leave` analytics) et corrigent les frictions vues en jeu. Tous en Anglais côté joueur.

### [ ] 16. Salles à événements variés — exploiter `ROOM_EVENTS` (SUITE de 3d)
> **DÉTAIL — #16 : 5 nouveaux events (de 1 → 6)**
> **Pourquoi :** techno prête, 1 exemple = pas de rejouabilité. 5 events = 5 raisons de fouiller. Effort S car infra `stampRoomInfo`/`tickRoomEvents` déjà câblée.
> **Design des 5 events :**
> 1. **Healing Shrine** (`healingShrine`, vert) : `+2 HP / 3s` si dans salle, max 20 HP. Particules `greenHeart` + message `"Healing Shrine — stay to heal"`. Idéal après combat.
> 2. **Poison Fog** (`poisonFog`, violet) : `-1 HP / 2s` + filtre vert `setClientOption fogColor`. Sortir = stop. Risque/récompense : chest au centre.
> 3. **Treasure Vault** (`treasureVault`, or) : `kind:"vault"` → 2× `Chest` garantis (posés en template), pas de mobs. `onEnter` → `"Vault! 2 chests"` + particule `goldFountain`.
> 4. **Ambush** (`ambush`, rouge) : `+100% mob count` (4→8 en Medium) + reward `+200 gold` si clear. `MOB_TUNING` ×2 local à la salle.
> 5. **Shop Room** (`shopRoom`, bleu) : `Artisan Bench` au centre (déjà en template) + `onEnter` → message `"Shop Room — craft here"` + 10% discount reforge si #13 livré.
> **Tagging :** `templates.js` → `[-6,1,0,{kind:"event",eventId:"healingShrine"}]`, `[-14,1,0,{kind:"event",eventId:"poisonFog"}]`, `[-22,1,0,"vault"]` (synonyme), etc. 5 rooms sur 20 = 25% events = bon ratio.
> **Technique :** `src/dungeon/events.js` → 5 entrées `ROOM_EVENTS[eventId] = {label, color, onEnter(api,playerId,x,y,z), onTick(api,playersInRoom), damage, interval}`. `api.getPosition` + `chunkOfWorld` pour savoir qui est dans la salle (déjà fait pour `lavaTrap`). Particules `PRESETS.magmaBurn` recyclé avec couleur.
> **Tests :** 5 tests (1 par event : heal, damage, vault no mobs, ambush count, shop discount).
> **DoD :** 6 events jouables + 5 rooms taguées + particules + messages + 5 tests + analytics.
> **Fichiers :** `src/dungeon/events.js` (+5), `src/dungeon/templates.js` (tag 5), `src/worldCode.js` (déjà intégré), `src/particles/config.js` (2 presets)
> **Métrique :** `analytics.room.event_enter` {eventId}, `analytics.room.event_clear_time`, `analytics.room.event_revisit_rate`
> **Impact :** ⭐⭐⭐ / Effort : **S** (1-2j) — **recommandé #1**
> **Risque :** 🟢 — no DB, no economy

### [ ] 17. Écran de fin de run (Run Summary)
> **DÉTAIL — #17 : la boucle "encore une"**
> **Déclencheurs :** 4 moyens existants → même récap : `Leave` (`onPlayerLeave`), `Finish Block` (`completeFinishCountdown`), `Button` (`onPlayerBoughtShopItem`), `Death` (`onRespawnRequest`).
> **Contenu (chat + middleText 4s) :**
> ```
> Run finished! +420 [Gold Coin]  Rooms 12  Kills 28  Time 08:32
> Depth 14 · Deepest 18 · New best! (si record)
> [Play Again] (shop tile Utilities, TP lobby pad)
> ```
> **Données :** `src/dungeon/service.js:runStats = Map<playerId, {startTick, rooms:0, kills:0, goldEarned:0, maxDepth:0}>` ; `startTick = tickNow()` à `enterDifficulty` ; `rooms` ++ à `discoverRoom` ; `kills` ++ à `onMobKilled` ; `goldEarned` ++ à `giveGold` + Finish ; `maxDepth` = `discovered.size`. Stocké en mémoire, pas de DB (run = session).
> **Affichage :** `renderRunSummary(playerId, stats)` → `api.sendMessage` 2 lignes + `api.setClientOption middleTextUpper` 4s + `queueMiddleTextUpper` si dispo. Bouton `Play Again` = `createShopItemForPlayer` `Utilities` `Replay` → `startLobbyCountdown` Medium.
> **Persistance légère :** `dungeonBreak.run.bestDepth.v1` (DB) pour `New best!` + `analytics.run.summary_shown` avec `numericValue = goldEarned`.
> **Tests :** 3 tests (stats inc, render, bestDepth), 1 test integration (Finish → summary + TP).
> **DoD :** 4 déclencheurs → même récap + bestDepth persistant + Play Again + analytics + 4 tests.
> **Fichiers :** `src/dungeon/service.js` (runStats), `src/worldCode.js` (renderRunSummary, 4 hooks), `src/utils/analytics.js` (run.summary)
> **Métrique :** `analytics.run.summary_shown` {reason, rooms, kills, gold, time}, `analytics.run.replay_rate` (2e run < 3min = 40% cible), `analytics.run.avg_duration`
> **Impact :** ⭐⭐⭐ / Effort : **S** (1j) — **recommandé #2, moment #1 rétention**
> **Risque :** 🟢

### [ ] 18. Mini-boussole + waypoints lobby/donjon
> **DÉTAIL — #18 : -20% frustration**
> **Comportement :**
> - **Au lobby** (`isAtSpawn`) : `groundArrowPath` jaune pointe vers `Quest NPC [5.5,21,4.5]` (nouveau joueur) ou `Daily pad` (Medium) si quête faite. Disparaît à `enterDifficulty`.
> - **En donjon** : `directionArrow` + `groundArrowPath` rouge pointe vers **Finish Block** si `getRoomData` a `eventId:"finish"` découvert (pos = `chunkToBlock(chunk)+[16, floorY, 16]`), sinon vers **prochaine salle non clear** la plus proche (scan `loader.planned` + `mobClearCell`).
> - **Toggle :** `/compass off` → DB `dungeonBreak.compass.v1 = {enabled:false}` + `clearDirectionArrow`.
> - **Refresh :** toutes les 20 ticks (1s) + à `discoverRoom`/`mobClear`.
> **Technique :** `src/worldCode.js:refreshCompass(playerId)` → `if (!isAtSpawn) {findFinishRoom() || findNearestUnclearRoom()} → api.setDirectionArrow` + `setClientOption groundArrowPath`. Coût 1 `getPosition` + scan mémoire.
> **Tests :** 2 tests (lobby arrow, dungeon finish arrow), 1 test toggle.
> **DoD :** flèche lobby + flèche donjon + toggle + refresh 1s + 3 tests + analytics.
> **Fichiers :** `src/worldCode.js` (refreshCompass), `src/dungeon/service.js:getRoomData` pour Finish pos, `src/dungeon/loader.js:findUnclear`
> **Métrique :** `analytics.navigation.waypoint_follow` (arrow active > 30s), `analytics.dungeon.time_to_finish`, `analytics.navigation.compass_toggle`
> **Impact :** ⭐⭐ / Effort : **S** (1j)
> **Risque :** 🟢

### [ ] 19. Équilibrage économie & courbe difficulté
> **DÉTAIL — #19 : audit chiffré**
> **État actuel :**
> - `DUNGEON_PRICES` : VeryEasy 0 → Easy 100 → Normal 500 → Medium 5k → Hard 25k → Insane 100k → Nightmare 500k → Hell 1M → Endless 0. **Hell 1M = 100 runs Hell (10k/run) = 10h grind = churn.**
> - `FINISH_REWARDS` : 100→200→400→800→1500→3000→6000→10000→5000. Ratio prix/reward Hell = 100× = trop.
> - `REROLL` 50+15/blessing = OK (200g à 10 blessings).
> - `Pass` 20 paliers 500 XP = 10k total, récompenses 12k gold total = OK.
> **Propositions (à valider data `dungeon/leave` analytics) :**
> 1. **Baisser Hell 1M→500k** (ou 750k) → 50 runs = 5h = acceptable hardcore.
> 2. **Augmenter Finish Hell 10k→20k + Endless 5k→10k +2%/depth** → 25 runs = 2.5h = mieux.
> 3. **Daily bonus :** premier Finish/jour (DB `dungeonBreak.dailyBonus.v1` date) → +500 gold + message `"Daily bonus! +500"` + icon. Cible +15% rétention D1.
> 4. **Afficher "Runs to next unlock"** en shop `Utilities` : `Hell 500k (you have 120k) → 19 runs` → transparence.
> 5. **Sink gold #13** calibré pour absorber +50% faucet → inflation 0.
> **Technique :** `src/dungeon/config.js:DUNGEON_PRICES`, `src/worldCode.js:FINISH_REWARDS` (const), `src/pass/config.js` inchangé, `src/dungeon/service.js:checkDailyBonus` (date UTC).
> **Tests :** 2 tests (daily bonus once, runsToUnlock calc), 1 test config (prices monotonic).
> **DoD :** Hell ≤500k + Finish Hell ≥15k + daily bonus + runsToUnlock UI + 3 tests + analytics `economy.gold_earned_per_run`.
> **Fichiers :** `src/dungeon/config.js`, `src/worldCode.js`, `src/dungeon/service.js`, `src/utils/analytics.js`
> **Métrique :** `analytics.economy.gold_earned_per_run` {difficulty}, `analytics.economy.daily_bonus_claimed`, `analytics.progression.days_to_hell` (cible 7j), `analytics.progression.unlock_rate` {difficulty}
> **Impact :** ⭐⭐⭐ / Effort : **S** (1j) — **data-driven, à faire avec #12**
> **Risque :** 🔴 touche économie — migration douce (ne pas rembourser, juste baisser prix)

### [ ] 20. Juice : son, particules, hit feedback
> **DÉTAIL — #20 : 0 gameplay, +15% polish**
> **Sons (si `api.playSound` existe, sinon fallback particules) :**
> 1. `finish_countdown_tick` — tick 1kHz court chaque seconde du hold 5s.
> 2. `finish_complete` — fanfare 2s (ex: `random.levelup` si Bloxd l'a, sinon `crateFountain` gold).
> 3. `room_clear` — ding `note.pling` à `CLEAR`.
> 4. `level_up` — `aura` level up (déjà partiel, ajouter `applyAuraChange` hook).
> 5. `crate_open` — déjà `crateFountain`, ajouter `chest_open` son.
> **Visuel :**
> - `screenShake` léger sur gros dégâts (>30% HP en 1 coup) : `api.setClientOption(playerId, {cameraShake: 0.3})` si existe, sinon `spawnParticles` flash rouge `0.2s`.
> - `damageNumber` couleur par set (déjà fait #1, juste ajouter `crit` jaune plus gros).
> **Technique :** `src/particles/config.js:PRESETS.finishTick/finishComplete/roomClearDing`, `src/worldCode.js:playJuice(event)` helper qui check `typeof api.playSound==="function"` + fallback. `src/combatFx/service.js:maybeShake(playerId, damage)`.
> **Tests :** 1 test juice helper (no throw if no API), 1 test room_clear ding.
> **DoD :** 5 sons (ou fallback) + shake + ding clear + 2 tests.
> **Fichiers :** `src/particles/config.js`, `src/worldCode.js`, `src/combatFx/service.js`, `src/utils/analytics.js` (debug)
> **Métrique :** `analytics.juice.sound_played` (debug only), retours qualitatifs (feedback #14)
> **Impact :** ⭐⭐ / Effort : **S** (1j)
> **Risque :** 🟢 — no gameplay

### [ ] 21. Finish en équipe + QoL coop
> **DÉTAIL — #21 : bloqueur coop, fix 1h**
> **Problème :** `completeFinishCountdown` TP solo → coéquipiers restent en donjon, team brisée, frustration.
> **Solution :**
> - `completeFinishCountdown(playerId)` → `teamId = getTeamId(pid)` → `members = getTeamMembers(teamId)` (ou `[pid]` si solo).
> - Pour chaque `member` dans `members` : `giveGold(member, reward)` (même reward, +10% bonus par coéquipier → `rewardTeam = floor(reward * (1 + 0.1*(n-1)))`), `sendMessage` récap, `spawnParticles`, `teleportToSpawn(member)`, `clearAllArrows(member)`, `endRun(member,"")`, `spawnMode.set(member,true)`, etc.
> - `disbandTeam(teamId)` propre + `cleanupReviveForPlayer` pour tous.
> - **Annulation :** si un membre quitte le bloc avant 5s → `cancelFinishCountdown` pour tous (check `members.every(m => isOnFinishBlock(m))` chaque tick, ou simple : si 1 quitte → cancel tous, comme lobby pads).
> - **Edge :** si membre déjà mort/downed → TP quand même après `revive` ou `disband`.
> **Technique :** `src/worldCode.js:completeFinishCountdown` + `cancelFinishCountdown` + `isOnFinishBlock` helper (check `api.getBlock(x,y-1,z)` = Finish Block). `src/dungeon/service.js` inchangé (team déjà géré).
> **Tests :** 2 tests (team TP 2 members + reward bonus, cancel on leave 1).
> **DoD :** team Finish TP tous + bonus + cancel group + 2 tests + analytics.
> **Fichiers :** `src/worldCode.js:completeFinishCountdown`, `src/dungeon/service.js` (maybe helper)
> **Métrique :** `analytics.coop.finish_together` {teamSize, reward}, `analytics.coop.finish_cancel_team`, `analytics.coop.retention_vs_solo`
> **Impact :** ⭐⭐⭐ / Effort : **S** (2h) — **bloqueur coop P0 si coop est P1**
> **Risque :** 🟢

### [ ] 22. Streak quotidien & calendrier
> **DÉTAIL — #22 : rétention D1→D7**
> **Contenu :** calendrier 7 jours, reset **00:00 UTC**, streak = jours consécutifs avec ≥1 `dungeon/leave` (donc ≥1 run fini/mort/TP). Pas juste login → doit jouer.
> - **DB :** `dungeonBreak.streak.v1 = {lastDate:"2026-11-26", streak:3, claimedToday:false}`. `lastDate` = ISO date locale serveur. Si `today == lastDate` → déjà compté. Si `today == lastDate+1` → `streak++`. Si `today > lastDate+1` (≥48h) → `streak=1`. `claimedToday` évite double claim.
> - **Récompenses :** J1 100g, J2 200g, J3 300g, J4 500g, J5 750g, J6 1000g, J7 **Gold Key** (ou 1500g si pas de clé). Total semaine = 3 850g + 1 clé = ~0.5 palier Hell.
> - **UI :** lobby `headerChip` `"🔥 Streak 3 — claim 300g!"` (via `setClientOptions headerChips`) + `middleTextLower` 3s à `onPlayerJoin` si streak. Shop `Calendar` catégorie (ou `Pass` sub) avec 7 tuiles grisées/vertes + bouton `Claim`.
> - **Claim :** `onStreakClaim(playerId)` → check `isTodayEligible()` → `giveGold(reward)` → `analytics.streak.claimed` + `trackPos`.
> - **Anti-abus :** 1 claim/j max, pas de recul date, DB par joueur pas globale.
> **Technique :** `src/streak/service.js` (new, 80 lignes) : `getStreak(playerId)`, `updateStreakOnLeave(playerId)`, `claimStreak(playerId)`, `streakRewardFor(day)`. Hook `service.teleportToSpawn`/`leave` → `updateStreakOnLeave`. `src/worldCode.js:onPlayerJoin` → `showStreakChip`.
> **Tests :** 4 tests (inc, reset 48h, claim once, J7 key), 1 test UI chip.
> **DoD :** DB streak + 7 récompenses + UI chip + claim + 5 tests + analytics.
> **Fichiers :** `src/streak/service.js` (new), `src/streak/config.js` (STREAK_REWARDS), `src/worldCode.js:onPlayerJoin` + `service.leave`, `src/utils/analytics.js`
> **Métrique :** `analytics.streak.day_n` {day:1..7}, `analytics.streak.claimed` {day, reward}, `analytics.streak.reset` {streak}, `analytics.retention.d1` (avec streak vs sans), `analytics.retention.d7`
> **Impact :** ⭐⭐⭐ / Effort : **S** (1-2j) — **recommandé #3, ROI rétention #1**
> **Risque :** 🟡 économie — 3.8k/semaine = 5% inflation = OK si sink #13

### [ ] 23. Preview craft & comparatif d'items
> **DÉTAIL — #23 : finition #2**
> **Problème :** réorg stations (#2) faite mais pas le "est-ce mieux que ce que j'ai ?" → 40% crafts regrettés (craft puis drop <5min).
> **Solution :**
> - **Comparatif :** shop `Crafting` lore tuile affiche `"+12 DMG vs equipped (+3) | +5 HP"` en vert/rouge. `equipped = api.getItemSlot(playerId, weaponSlot)` → `getItemStats(equipped)` vs `getItemStats(recipe.result)`. Si pas d'équipé → `"First of its type!"`.
> - **Filtres :** `Owned` tab (recettes où `hasItem(result)`) / `Missing mats` (manque 1 fragment) / `All` via shop category sub-tiles ou `/craft filter`.
> - **Preview 3D :** si `api.giveItemPreview` existe → preview 2s, sinon texte `"Preview: Iron Sword — 15 DMG, 5% crit"`.
> - **Coût affiché :** `"Cost: 3× Iron Fragment (you have 2) — need 1 more"` en rouge si manque.
> **Technique :** `src/crafting/service.js:getCraftComparison(playerId, recipe)` + `src/crafting/itemStats.js:compareStats(a,b)`. `src/worldCode.js:refreshCraftShop(playerId)` → lore dynamique.
> **Tests :** 2 tests (compare better/worse, missing mats msg), 1 test lore.
> **DoD :** comparatif vert/rouge + filtres + coût clair + 3 tests + analytics.
> **Fichiers :** `src/crafting/config.js` (filtres), `src/crafting/service.js` (comparison), `src/crafting/itemStats.js` (compare), `src/worldCode.js:refreshCraftShop`
> **Métrique :** `analytics.craft.preview_open`, `analytics.craft.comparison_view`, `analytics.craft.regret_rate` (craft → drop <5min doit baisser 40%→15%), `analytics.craft.filter_use`
> **Impact :** ⭐⭐ / Effort : **M** (2-3j)
> **Risque :** 🟢

### [ ] 24. Tutoriel étendu — tuer un mob + bénédiction
> **DÉTAIL — #24 : finir #3**
> **Manque :** tuto actuel 3 étapes (clé → crate → donjon) mais pas de "tuer un mob", "roll blessing", "ouvrir coffre donjon" → 35% joueurs meurent sans comprendre aura/points.
> **Ajout :** 3 étapes après entrée donjon :
> 4. **Tuer 1 mob** : flèche vers mob le plus proche + `"Kill it! Press LMB"` + highlight épée. `onMobKilled` → `"Nice! +12 aura"` + particule.
> 5. **Roll blessing** : si `auraLevel >=2` (1 point) → flèche shop + `"You have 1 point! Roll a Blessing"` + `configureShopCategoryForPlayer` highlight. `onBlessingPick` → suite.
> 6. **Ouvrir coffre donjon** : flèche vers `Chest` le plus proche (scan `getRoomData kind:"chest"` + `api.getBlock` Chest) + `"Chests give keys!"`.
> - Fin : `"Tutorial complete! +100 gold"` + `hasDoneTutorialExtended = true` (DB `dungeonBreak.tutorial.ext.v1`).
> - Skip : `/tutorial skip` ou quitter donjon → pas de spam.
> **Technique :** `src/tutorial/service.js:extendedSteps = [killMob, rollBlessing, openChest]` + `tickTutorialExtended` (comme `tickTutorialHighlight`).
> **Tests :** 2 tests (steps sequence, skip).
> **DoD :** 3 étapes + flèches + highlight + 100g + skip + 2 tests.
> **Fichiers :** `src/tutorial/service.js`, `src/worldCode.js:tick` + hooks, `src/tutorial/config.js` (TUTORIAL_EXTENDED)
> **Métrique :** `analytics.tutorial.ext_started`, `analytics.tutorial.ext_completed`, `analytics.tutorial.time_to_first_kill`
> **Impact :** ⭐⭐⭐ / Effort : **S** (1-2j) — **complète FTUE**
> **Risque :** 🟢

---

## 🟡 P2 — Qualité & Vie communautaire

### [ ] 7. Coop 2-3 joueurs + rez — PARTIELLEMENT FAIT (2026-11)
**Fait :** `createTeamForLobby`, `teamId` partagé à `enterDifficulty`, revive 10s au sol (`downedPlayers`, `reviveTick`, `8s immunity`, `directionArrow` rouge), wipe→spawn, anti-vol crates `crateIsOwnedByOther`.
**Reste détaillé :**
- **7a. UI vie alliée :** `RightInfoText` ou `headerChip` `"Teammate K4mi 12/20 HP"` + distance. Actuellement aveugle = pas de conscience coop.
- **7b. Coût rez :** actuellement gratuit → trop fort. Passer à `-50 gold + 1s invuln` ou `50% HP` pas 100%.
- **7c. Partage or :** kill/Finish → `rewardTeam` (#21) déjà, mais coffre clé → 1 clé pour ouvreur seul = OK (anti-vol). Pas de partage auto.
- **7d. Anti-grief :** `crateIsOwnedByOther` OK, mais pas de `pvp off` en donjon ? Vérifier `api.setPvp(false)` si existe, sinon `onPlayerDamagingPlayer` cancel si même `teamId`.
> **DÉTAIL — #7 complet :**
> **UI alliée :** `tickTeamHud()` toutes les 20 ticks → `api.getHealth(teammate)` + `getPosition` distance → `setClientOption headerChips [{str:"K4mi 12/20 ❤ 8m"}]`.
> **Rez payant :** `revivePlayer(downedId)` → `spendGold(reviverId, 50)` ? Ou gratuit mais 50% HP + 5s immunity seulement. Choix : gratuit pour D1, payant après data.
> **PvP :** `onPlayerDamagingPlayer(attackerId, victimId)` → if `getTeamId(att)==getTeamId(vic)` → `return false` (cancel) + message `"Friendly fire off!"`.
> **Wipe polish :** `team wiped` → récap #17 pour team + `disbandTeam` + `/team` commande.
> **DoD #7 complet :** 3P lobby + team TP + revive 10s + wipe + UI HP + pvp off + anti-vol + #21 + 5 tests.
> **Fichiers :** `src/worldCode.js:onPadStart` (team), `src/dungeon/service.js` (team), `src/crate/service.js` (anti-vol), `src/team/service.js` (new si extrait)
> **Métrique :** `analytics.coop.run_started` {teamSize}, `analytics.coop.rez_count`, `analytics.coop.wipe_rate`, `analytics.coop.retention_vs_solo` (cible +20%)
> **Impact :** ⭐⭐⭐ / Effort : **L** (1-3 sem) → **fait à 70%, reste 30% = #21 + UI + PvP**

---

### [ ] 8. Saisons 6 semaines (reset doux, pas full wipe)
> **DÉTAIL — #8 : saison 1 design**
> **Concept :** reset doux, pas wipe ragequit. Garde ce qui est "identité", reset ce qui est "farm".
> **Garde :** `dungeonBreak.blessings.v1` permanent (ex: 40% joueurs ont 10+ permanents) + `ranks` + cosmétiques + `bestDepth`. **Ne pas reset** = respect temps investi.
> **Reset :** `run`/`timed` blessings + `gold` (ou 50% ?) + `streak` + `weekly` + `pity` + `pass` (recommence à 0 avec nouvelles récompenses). Choix : gold reset 100% saison 1 pour économie saine, sinon 50% si retours négatifs.
> **Contenu saison 1 "Volcanic" :**
> - Reskin 5 rooms existantes : `Lava` → `Obsidian` palette, mobs `Furnace Knight +20%` en Medium+.
> - 2 nouveaux sets : `Obsidian Sword` (fire dmg) + `Magma Armor` (fire resist) via `src/armor/config.js` + `src/weapons/config.js`.
> - Nouvelle affixe saisonnière `Volcanic` (voir #11) + Boss Rush `Furnace Colossus`.
> **Technique :**
> - `src/season/config.js:SEASON = {id:1, name:"Volcanic", start: "2026-12-01", end:"2027-01-12", keepKeys:["blessings","ranks"], resetKeys:["gold","run","streak","pass"]}`.
> - `src/season/service.js:migrateSeason(playerId)` → check `dungeonBreak.season.v1 != SEASON.id` → `backupOldSeason` (log) + `resetKeys` + `saveSeasonId`.
> - Annonce lobby `headerChip "Season 1: Volcanic — 12 days left!"` + `/season` commande.
> **Tests :** 3 tests (migrate keep, reset, backup), 1 test season active.
> **DoD :** config saison + migrate keep/reset + 2 sets + reskin 5 rooms + annonce + 4 tests + analytics.
> **Fichiers :** `src/ranks/config.js`, `src/dungeon/templates.js` (reskin), `src/blessing/service.js:resetPlayerProgress`, `src/season/config.js` (new), `src/season/service.js` (new)
> **Métrique :** `analytics.season.active_players`, `analytics.season.returning_rate` (cible 60% reviennent J1 saison 2), `analytics.season.gold_reset_sentiment` (feedback)
> **Impact :** ⭐⭐ / Effort : **L** (1-2 sem) — **Mois 3, pas avant**
> **Risque :** 🔴 reset gold = sensible — survey avant, 50% si négatif

---

### [ ] 9. Cosmétiques liés aux Ranks (éthique) — PARTIELLEMENT FAIT
**Fait :** système Ranks complet : 12 ranks (OWNER/TESTER/MEMBER/HUNTER/SLAYER/EXPLORER/VETERAN/CHAMPION/LEGEND...), unlocks par crates/kills/rooms/temps, chat prefix + `colorInLobbyLeaderboard` + `nameColour` + `nameTagInfo` via `applyRankVisuals()`, catégorie shop `Utilities` unifiée (ex-Ranks déplacé), dropdown sélection.
> **DÉTAIL — #9 manquant : trails, emotes, preview**
> **Trails particules :** 6 trails débloqués par rank, équipables :
> | Rank | Trail | Particules |
> |---|---|---|
> | HUNTER | `Smoke` | gris léger derrière pieds |
> | SLAYER | `Flame` | `flame` tick |
> | EXPLORER | `Hearts` | `heart` vert |
> | VETERAN | `Stars` | `star` or |
> | CHAMPION | `Lightning` | `lightning` bleu |
> | LEGEND | `Rainbow` | cycle couleur |
> - `src/particles/config.js:TRAILS = {smoke:{particle:"smoke", interval:5}, ...}` ; `tickTrails()` chaque 5 ticks → `spawnParticles` à `getPosition` si `playerTrail[playerId]`.
> - Shop `Cosmetics` → `Trail: Flame [Equip]` (0 gold, rank requis) + `Unequip`.
> **Titre chat custom :** `CHAMPION+` peuvent `/title set "Dungeon Master"` (20 chars, filtre mots) → `playerTitle[playerId]` + `applyRankVisuals` prefix `[Title] RankName`. Stock DB `dungeonBreak.title.v1`.
> **Emote :** `/emote dance` → `api.setPlayerPose` + `playSound` + particule `heart` 3s. 3 emotes (dance, wave, cheer) débloquées par rank.
> **Preview :** `/rank preview <rank>` → spawn NPC temporaire avec rank couleur + trail 5s + `sendMessage` stats.
> **Éthique :** 0 P2W, 0 vente gold, tout débloqué en jouant (rank = temps/skill, pas achat).
> **Tests :** 3 tests (trail equip, title filter, emote cooldown 5s).
> **DoD :** 6 trails + titre + 3 emotes + preview + shop + 4 tests + analytics.
> **Fichiers :** `src/ranks/config.js` (`RANKS` + `TRAILS`), `src/ranks/service.js` (trail/title/emote), `src/particles/config.js` (trail presets), `src/worldCode.js:refreshRanksShop/applyRankVisuals/tickTrails`
> **Métrique :** `analytics.cosmetic.trail_equip`, `analytics.cosmetic.title_set`, `analytics.cosmetic.emote_use`, `analytics.shop.rank_preview`
> **Impact :** ⭐ / Effort : **S** (2-3j) → **fait à 60%, reste 40% = trails/emotes**
> **Risque :** 🟢

---

### [x] 10. Metrics in-game + feedback natif (sans Discord) — FAIT (wrapper + instrumentation, feedback panel TODO)
**Fait :**
- **Wrapper vérifié** `src/utils/analytics.js` : `api.registerAnalyticsEvent(playerId, eventType, eventValue, gameCategoryId, gameStartTimeMs, position, numericValue)` — API Bloxd Custom games vérifiée via `bloxd.io/docs/api-reference` (09/11/2026). Limites : 20 evt/min/player, 20 catégories/jour, 20 types/cat/jour. Fallback `api.log` si pas dispo. `track(playerId, eventType, eventValue, opts)` + helpers `Analytics.*` + `trackPos`.
- **Instrumentation :** `worldCode.js` (join/leave, dungeon enter/leave, room_discover, pad_use, combat hit/kill/damage_taken, crate click, shop teleport, onPlayerCrafted), `blessing/service.js` (roll/pick/reroll), `quest/service.js` (take/reroll/complete/claimed), `pass/service.js` (xp_gain, level, tier_claim), `tutorial/service.js` (start/crate_opened/complete).
- Contrainte externe respectée : **aucun call externe**, tout via Bloxd interne.
**Reste TODO :** shop catégorie "Donner mon avis" (emoji + texte), dashboard interne clear rate / temps moyen, patch notes in-game — non bloquant pour les metrics → voir #14.
**Fichiers :** `src/utils/analytics.js` (nouveau), `src/worldCode.js`, `src/blessing/service.js`, `src/quest/service.js`, `src/pass/service.js`, `src/tutorial/service.js`
**Métrique :** `analytics.feedback.sent`, `analytics.feedback.satisfaction_avg`
**Impact :** ⭐⭐ / Effort : **S** → **fait**

---

### [ ] 14. Feedback in-game + Leaderboard local
> **DÉTAIL — #14 : débloqué par #10, 0 externe**
> **Feedback shop :**
> - Catégorie `Feedback` : 5 tuiles emoji `😍 🥰 🙂 😐 😞` → `track(playerId, "feedback", "sent", {numericValue: 1..5, gameCategoryId: "satisfaction"})` + `RightInfoText` `"Thanks! Your vote: 5/5"` 5s. Option texte : `/feedback "love boss rush"` → `api.getPlayerDbValue` `dungeonBreak.feedback.v1` queue 10 derniers (admin `/feedback list`).
> - Patch notes : `src/feedback/config.js:PATCH_NOTES = [{v:"1.2", date:"2026-11-26", notes:["Finish 5s hold","20 rooms"]}]` + shop `News` tuile `Patch 1.2` → chat 5 lignes.
> **Leaderboard local :**
> - 3 tabs via `/lb` + shop `Leaderboard` : `Richest` (gold `cstm_smp_gold` via `getCurrencyAmount`), `Deepest` (max depth Hell/Endless `dungeonBreak.run.bestDepth.v1`), `Fastest` (temps VeryEasy→Hell, `runStats` total ticks → `endlessFactor` ?).
> - Stockage : `api.getWorldDbValue`/`setWorldDbValue` `dungeonBreak.lb.v1 = {richest:[{name,gold,date}], deepest:[...], fastest:[...]}` top 20. Anti-spam : 1 submit/run (flag `submittedThisRun`).
> - Submit : à chaque `run summary` (#17) → `if (gold>lbMin) push + sort - slice 20`.
> - Affichage : `chat` 10 lignes `1. K4mi — 1 250 000 gold` + `middleText` gold.
> **Technique :** `src/feedback/service.js` (new, 40 lignes), `src/leaderboard/service.js` (new, 100 lignes), `src/worldCode.js` shop `Feedback`/`Leaderboard` + `/lb` + `/feedback`.
> **Tests :** 3 tests (feedback vote, lb push/sort, anti-spam).
> **DoD :** 5 emojis + patch notes + 3 tabs lb + world DB top20 + 3 tests + analytics.
> **Fichiers :** `src/feedback/service.js` (new), `src/leaderboard/service.js` (new), `src/feedback/config.js` (PATCH_NOTES), `src/worldCode.js` (shop category + commands)
> **Métrique :** `analytics.feedback.sent_rate` {score}, `analytics.feedback.text_sent`, `analytics.leaderboard.view` {tab}, `analytics.leaderboard.submit` {tab}
> **Impact :** ⭐⭐ / Effort : **M** (3-5j)
> **Risque :** 🟢 — world DB 20 entrées = safe

---

### [ ] 15. Qualité de vie craft/inventaire
> **DÉTAIL — #15 : 4 QoL qui enlèvent 50 clics/heure**
> **a) Mass craft :** `Shift+Click` sur recette → `x5`, `Ctrl+Click` → `x10` (ou 2 tuiles `Craft x1` / `Craft x5` par recette). `src/crafting/service.js:craftMultiple(playerId, recipe, count)` → boucle `craft()` avec check mats chaque itération. Sinon 1 craft à la fois = 50 clics pour 10 lingots.
> **b) Comparer :** déjà #23 comparatif vert/rouge, #15 = **hover** = `onPlayerClick` sur item au sol → tooltip `vs equipped` côte-à-côte (même helper que #23).
> **c) Loadout 2 slots :** `Loadout A/B` shop `Utilities` → `saveLoadout(playerId, slot)` = `{weapon: weaponName, armorSet: armorSetId}` (scan `getItemSlot` pour arme/armure équipée = slot 0-9 hotbar ?). `loadLoadout` → `swapToLoadout` 3s cooldown (évite spam). DB `dungeonBreak.loadout.v1 = {A:{weapon,armor}, B:{...}}`.
> **d) Tri auto :** bouton `Sort` en inventaire (ou `/sort`) → `Iron Fragment → stock` : scan 60 slots, move fragments vers slots 10-30 vides, armes vers 0-9, armures vers 30-40. 1 clic vs 20 drags.
> **Technique :** `src/crafting/service.js:craftMultiple`, `src/loadout/service.js` (new, 60 lignes : save/load/swap), `src/inventory/service.js:sortInventory` (new, 40 lignes).
> **Tests :** 4 tests (mass craft 5, loadout save/load, sort fragments, cooldown).
> **DoD :** mass craft x5/x10 + comparer + 2 loadouts + sort + 4 tests + analytics.
> **Fichiers :** `src/crafting/service.js` (`craftMultiple`), `src/worldCode.js` (`onPlayerClick` compare), `src/loadout/service.js` (new), `src/inventory/service.js` (new)
> **Métrique :** `analytics.craft.mass_craft_rate` {count}, `analytics.craft.compare_view`, `analytics.loadout.switch` {slot}, `analytics.inventory.sort` 
> **Impact :** ⭐⭐ / Effort : **M** (3-5j) → fusion possible avec #23 (preview) = 1 sprint QoL
> **Risque :** 🟢

---

## 📦 Faits depuis 2026-02-15 — hors TODO initial (non listés au-dessus)

Ces features sont en prod mais n'étaient pas dans le TODO d'origine — à intégrer ou non dans la prochaine roadmap :

- **Quêtes étendues (PR #158) :** 19 templates, 8 types, scaling `powerScore` 0..8, Pass XP dynamique `x±100` (voir §4)
- **Pass 20 tiers complet** avec 20 récompenses (gold/keys/fragments/Diamond/Nova Alloy), barres de progression, DB `dungeonBreak.pass.v1`
- **Reroll Blessings gold** (PR #159-160) — très abordable 50 +15/blessing (voir §6)
- **Unification shop Ranks → Utilities** (PR #158) : plus propre, 1 catégorie
- **Blessings catalogue x3 :** ~62 blessings (vs 20 initiales) avec tradeoffs bonus/malus type Hades/Dead Cells, 6 raretés, 3 scopes (PERM/RUN/TIMED)
- **Caisse/Crate :** système clés 5 raretés, protection anti-vol 16s, file chunked 6 slots/tick, particules `crateFountain`
- **Crates re-tierées (2026-11-23) :** `Common=bois`, `Uncommon=stone+4 premiers fragments`, `Rare=fer+Sanguine/Spectral/Geo`, `Epic=or+Astral/Comet/Voltite`, `Legendary=diamant+Star Alloy`; `Cotton/Arrow/Coal` only Common, `Apple/Bread` partout
- **Mobs fiables (2026-11-23) :** fix cap 64 → plus de ban bestiaire, retry salles vides
- **Armures/Armes/CombatFx :** 12 Armor Sets + 72 Weapons (8 types × 9 sets), stats auto-scalées, capacités élémentaires, shimmer tick
- **Dungeon tech :** chunks 32³ via `copyChunk`, Bedrock probe, séparation 20 000 blocs, `spawnSeparation`, `chunkLoadTicks:2`, découverte de salles +aura `roomAuraFor`/`mobAuraFor`, loot `mobLoot`
- **Endless (2026-11-24) :** 9e difficulté `Endless` (White Concrete, après Hell), +2% dégâts/mobs/XP par salle, cap 20 mobs, `/dbg seed` reste debug (pas de partage)
- **Particules :** `entryVortex`, `padRing/Tick`, `crateFountain`, etc.
- **Tutoriel natif** (voir §3)
- **Chest rooms tagging + Finish Block (2026-11-26) :** 20 rooms (3× chest, 1× finish -40), `coin [0,0,0] blockData` identity, `ROOM_EVENTS` extensible (`lavaTrap` exemple), `dungeon/leave` analytics 4 moyens, Finish 5s hold Anglais + Gold Coin icon — PR #186 + hotfix 539e46a
- **Analytics minimal (2026-11-26) :** 4 events seulement (limite 20/j), `dungeon/leave` partout
- **TODO deep-dive (2026-11-26) :** ce fichier → tous les points non faits détaillés avec design, tech, tests, DoD

---

## 🚨 Manques signalés — à prioriser (résumé)

| # | Manque | Priorité | Effort | Notes 2026-11-26 |
|---|--------|----------|--------|-----------------|
| 11 | **Quêtes hebdo + affixes** | P1 — haute | M | **détaillé** — 5 hebdo + 6 affixes |
| 12 | **Pity crates** | P1 — haute | S | **détaillé** — pity 25 + dupe fragments |
| 13 | **Reforge** | P1 — moy | M | **détaillé** — Anvil 3 rerolls |
| 6 | **Synergies Blessings** | P1 — moy | S | **détaillé** — 8 synergies vertes |
| 5 | **Boss Rush** | P1 — moy | M | **détaillé** — 5 boss arènes |
| 16 | **Salles events variés** | P1 — haute | S | **détaillé** — 5 events (1→6) |
| 17 | **Run Summary** | P1 — haute | S | **détaillé** — boucle rétention |
| 21 | **Finish team TP** | P1 — haute | S | **détaillé** — bloqueur coop |
| 22 | **Streak quotidien** | P1 — haute | S | **détaillé** — D1→D7 |
| 19 | **Économie** | P1 — haute | S | **détaillé** — Hell 1M→500k |
| 7 | **Coop + rez** | P2 — haute | L | **détaillé** — 70% fait, reste UI+PvP |
| 14 | **Feedback + Leaderboard** | P2 — moy | M | **détaillé** — shop + world DB |
| 15/23 | **QoL craft + preview** | P2 — moy | M | **détaillé** — mass craft + compare + loadout |
| 8 | **Saisons** | P2 — basse | L | **détaillé** — Volcanic 6 sem |
| 9 | **Cosmétiques Rank** | P2 — basse | S | **détaillé** — 6 trails + emotes |
| 24 | **Tuto étendu** | P1 — moy | S | **NEW** — kill + blessing + coffre |
| 18 | **Boussole** | P2 — moy | S | **détaillé** |
| 20 | **Juice SFX** | P2 — basse | S | **détaillé** |

---

## Métriques — implémentation Bloxd

> API vérifiée : `api.registerAnalyticsEvent(playerId, eventType[64], eventValue[128|null], gameCategoryId[128|null], gameStartTimeMs, position[3]|null, numericValue|null)` + `api.registerAnalyticsPlayerPosition`. Custom games only.

```js
// Wrapper en prod : src/utils/analytics.js
import { track, Analytics } from "./utils/analytics.js";
track(playerId, "blessing", "pick", { gameCategoryId: blessingId });
track(playerId, "dungeon", "enter", { gameCategoryId: difficulty.id });
Analytics.mobKill(playerId); // alias
Analytics.dungeonLeave(playerId); // 2026-11-26 : leave/Finish/Button/Death
// Nouveaux proposés :
track(playerId, "room", "event_enter", { gameCategoryId: eventId });
track(playerId, "run", "summary", { numericValue: goldEarned });
track(playerId, "crate", "pity_triggered", { gameCategoryId: rarity });
track(playerId, "streak", "claimed", { numericValue: day });
```

**Events prioritaires à logger :** `tutorial.completed`, `craft.success`, `run.clear`, `run.death`, `blessing.pick`, `blessing.reroll`, `blessing.synergy_triggered`, `quest.complete`, `crate.open`, `crate.pity_triggered`, `coop.run_started`, `dungeon.leave`, `room.event_enter`, `run.summary_shown`, `streak.claimed`, `economy.gold_earned`

---

## Roadmap suggérée — mise à jour 2026-11-27

### Sprint 1 — "Feel Good" (cette semaine, 5-7j) — 3 petits qui changent tout
- **#16 Events variés** (1j) + **#17 Run Summary** (1j) + **#21 Finish team** (2h) = **2j, impact ⭐⭐⭐**
- **#12 Pity** (1j) + **#22 Streak** (1j) = rétention D1→D7
- = 4j total, 5 features visibles jour 1, 0 risque 🔴

### Sprint 2 — "Progression" (semaine 2, 5-7j)
- **#11 Hebdo+affixe** (3j) + **#13 Reforge** (2j) + **#6 Synergies** (1j) = boucle hebdo + sink gold + builds
- **#19 Économie** (1j) en parallèle — data `economy.gold_earned` du Sprint 1

### Sprint 3 — "Polish & QoL" (semaine 3-4)
- **#15/#23 QoL craft** (3j) + **#18 Boussole** (1j) + **#20 Juice SFX** (1j) + **#24 Tuto étendu** (1j) = FTUE + polish

### Sprint 4 — "Hardcore" (mois 2)
- **#5 Boss Rush** (5j) + **#7 finition coop** UI vie alliée + PvP off (3j) = contenu endgame

### Mois 3 — "Live Ops"
- **#8 Saison 1 Volcanic** (1 sem) + **#14 Feedback/Leaderboard** (3j) + **#9 Cosmétiques trails** (2j) = live ops

> **Ordre justifié :** on capitalise sur `coin blockData`/`ROOM_EVENTS` livrés 26/11 → #16 est 1j et débloque 6× contenu sans nouvelle map. Puis pity+streak (rétention immédiate) avant gros chantiers (Boss Rush, Saisons).

**Capacité :** S=1j, M=3j, L=1sem → 4 sprints = 1 mois + 1 mois saisons = 2 mois total pour TODO complet (hors Saisons L qui s'étale).

---

## Comment contribuer

1. Crée une branche `arena/<id>-dungeon-break`
2. Coche `[x]` ici + ajoute test dans `tests/` si logique (voir DoD de chaque ticket)
3. `npm run build` → `npm test` (167 tests, cible 200+ avec #5/#11/#12) → PR → merge auto autorisé (cf `AGENT_RULES.md`)
4. Pour gros ticket (Boss Rush, Saisons), découper en 2 PRs : config+templates puis logique+tests

*Dernière mise à jour : 2026-11-27 — mainteneur : @Souls-equal — Deep-dive complet : tous les points non faits détaillés (design, tech, tests, DoD, métriques, risques) + roadmap 4 sprints priorisée + #24 tuto étendu*
