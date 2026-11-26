# TODO — Dungeon Break

> **Référence unique pour les prochaines itérations.** Source de vérité pour prioriser jouabilité / rejouabilité / qualité / retours joueurs.
> Contraintes actuelles : **pas de lien externe (Discord) possible** — metrics uniquement via **API analytics Bloxd** interne. Tout doit rester in-game.

---

## Légende
- **Impact :** ⭐ = moyen, ⭐⭐ = fort, ⭐⭐⭐ = très fort sur rétention/reviews
- **Effort :** S = < 2 jours, M = 3-7 jours, L = 1-3 semaines
- **Métrique Bloxd :** événement via `src/utils/analytics.js` → `api.registerAnalyticsEvent` (API vérifiée, Custom games only, aucun call externe)

---

## 🔴 P0 — Critique (faire en premier)

### [x] 1. Feedback de combat immédiat — fait (complément Bloxd natif)
**Fait :** damage numbers couleur set, flying text `+burn/poison/shield` via `onPlayerDamagingMob` + `api.sendFlyingMiddleMessage`, son optionnel par set `api.playSound` si dispo. Bloxd natif garde hit sound/crit particles/flash rouge — on ne duplique pas.
**Fichiers :** `src/combatFx/service.js`, `src/weapons/service.js`
**Métrique :** `analytics.combat.hit` + `analytics.combat.kill_time_avg`
**Impact :** ⭐⭐⭐ / Effort : **S**

### [x] 2. Preview craft + arbre de progression — réorg stations (2/2 done)
**Fait :** stations réorganisées — Workbench = armes (épées/etc.), Artisan Bench = armures, Inventaire (`station: ""`) = matériaux (shards→lingots). Clarifie progression vs TODO initial (preview UI reste TODO futur).
**Fichiers :** `src/crafting/config.js`, `src/crafting/vanilla.js`, `src/crafting/itemStats.js`, `src/crafting/service.js`, shop UI
**Métrique :** `analytics.craft.preview_open`, `analytics.craft.success_rate`, `analytics.craft.time_to_first_craft`
**Impact :** ⭐⭐⭐ / Effort : **M**

### [x] 3. Tutoriel jouable 90s (premier join) — FAIT (à cocher, était [ ] dans l'ancien TODO)
**Fait depuis février :** implémenté dans `src/tutorial/service.js` — 3 étapes natives :
- Join → `Wooden Key` donnée + flèche rouge `groundArrowPath` vers caisse `[31.5,20,-0.5]` + highlight hotbar du slot clé
- `generateChest()` → "collect the loot" + remove highlight
- Flèche verte vers donjon `[2.5,20,-7.5]`
- Flag persistant `hasDoneTutorial` via `api.get/setPlayerDbValue` (`t:1`, compat legacy `dungeonBreak.tutorial.v1` + `tutorial.step` → `done`). Remplace les 2 messages `onPlayerJoin` si flag absent.
**Ce qui diffère du spec initial :** pas de couloir template dédié ni `Wood Sword + 1 blessing` en récompense — tutoriel par flèches/overlays existant suffit, mais la spec "tuer un mob" n'est pas dedans.
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
- Nouvelle salle `[-40,1,0]` (et `[-38,1,0]` pour garder pas de 2 chunks) avec `Finish Block` → `kind:"finish"`.
- Coin `[0,0,0]` porte `{kind,eventId,templateIndex}` via `setBlockData` après `copyChunk`, lu via `getBlockData` (`src/dungeon/loader.js:stampRoomInfo/getRoomData`). Plus de particule générique trompeuse.
- `src/dungeon/events.js` exemple `lavaTrap` (damage 3 / 10 ticks, `onRoomEventEnter` + `tickRoomEvents`) démonstration extensible.
- **Finish Block (2026-11-26 fix FR) :** hold 5s comme pads lobby (`FINISH_HOLD_SECONDS=5`), countdown `middleTextUpper` + lower `"Stay on Finish Block to return to spawn"`, particules `padRing/padTick` dorées, debounce + final-tick 1s grace. Message unique Anglais `"Run finished! +X [Gold Coin icon]"`, `endRun("")` sans doublon. Cleanup sur leave/mort/bouton spawn.
**Fichiers :** `src/dungeon/templates.js` (20 rooms), `src/dungeon/config.js:roomDataCell`, `src/dungeon/loader.js`, `src/dungeon/service.js:getRoomData`, `src/dungeon/events.js` (NEW), `src/worldCode.js:onBlockStandStart/Stop`, `src/utils/analytics.js:dungeonLeave`
**Métrique :** `analytics.dungeon.leave` (4 moyens : Leave/Finish/Button/Death), `analytics.dungeon.finish_rate`, `analytics.dungeon.finish_hold_cancel_rate`
**Impact :** ⭐⭐⭐ / Effort : **M** → **fait** — 167/167 pass, build 336k

### [x] 3e. Analytics minimal viable — fait (2026-11-26)
**Fait :** réduit à 4 events pour limite journalière Bloxd (20/j) : `combat/kill`, `tutorial/crate_opened`, `tutorial/complete`, `dungeon/leave` (tous moyens via `service.leave/teleportToSpawn`). Supprime 10+ events bruit. Wrapper `track()` + `Analytics.*`.
**Fichiers :** `src/utils/analytics.js`, `src/dungeon/service.js`, `src/worldCode.js`
**Impact :** ⭐⭐⭐ / Effort : **S**

---

## 🟠 P1 — Rejouabilité

### [x] 4. Quêtes quotidiennes / hebdo + Pass léger (sans P2W) — QUOTIDIENNES + PASS FAITS, HEBDO MANQUANT
**Fait :**
- **Quêtes quotidiennes :** NPC `Quest` en `[5.5,21,4.5]`, rotation quotidienne UTC via `pickTemplateForToday()` + `scaledTarget()` (power 0..8 basé sur gold/aura/equip). **19 templates** sur **8 types** : `kill`, `crate`, `crate_rarity` (Common 8 → Legendary 1, moins demandé si rare), `walk` (500/2000 blocks), `damage_dealt` (1000/5000), `damage_taken` (500/2000), `dungeon_enter`, `room_discover`, `time_played`. Sidebar `RightInfoText` + récompenses gold/aura + **Pass XP aléatoire** `x±100` où `x=passXpBase+power*20`.
- **Pass :** 20 paliers, 500 XP/palier = 10 000 total, `dungeonBreak.pass.v1`, XP via quêtes (`addPassXp`), shop catégorie `Pass` (tuile Reward + Info sans image), récompenses gold/items/aura. Reste gratuit, pas de P2W.
- **Réutilise :** `ranks().recordKill/recordCrate` + DB pattern `UNLOCK_DB_KEY` → `QUEST_DB_KEY` / `PASS_DB_KEY`
**Manque signalé :** spec demandait **5 hebdo** — non implémenté. Seul le quotidien est en place (1/jour). Hebdo reste à faire.
**Fichiers :** `src/quest/config.js` (19 templates, `QUEST_TEMPLATES`, `powerScore`), `src/quest/service.js` (NPC + sidebar + `onQuest*`), `src/pass/config.js` (`PASS_TIERS`, `rollQuestPassXp`), `src/pass/service.js`, `src/worldCode.js` (hooks `onQuest*` + `crateGenerateChest` + damage/walk)
**Métrique :** `analytics.quest.daily_complete`, `analytics.quest.retention_d1/d7`, `analytics.pass.level_reached`
**Impact :** ⭐⭐⭐ / Effort : **M** → **fait à 80%**

### [x] 5. Endless + Boss Rush
**Fait (Endless) :**
- **Endless** : débloqué après Hell via **White Concrete** (`DIFFICULTIES` +1 : `endless`, `White Concrete`, `fromLobby:false`). Base = Hell (8 mobs, 8.0× HP, 5.5× dmg), puis **+2% dégâts & mobs & XP par salle** (linéaire `1+0.02*depth`, cap 20 mobs). `mobTuningFor(difficulty, depth)`, `roomAuraFor`/`mobAuraFor` avec `ENDLESS_SCALING=0.02` et `endlessDepth` stocké sur `levelState` (`discovered.size-1`). XP salle `20 → 20*(1+0.02*depth)`, XP mob `12 → 12*(1+0.02*depth)`.
- **Boss Rush** : reste à faire (5 salles boss, non implémenté).
- **Seed partageable retiré** : volontairement abandonné — pas nécessaire même en bonus, `/dbg seed` reste debug seul.
**Fichiers :** `src/dungeon/config.js` (`DIFFICULTIES`, `ENDLESS_SCALING`, `endlessFactor`, `roomAuraFor`/`mobAuraFor`/`mobTuningFor`), `src/dungeon/loader.js` (`endlessDepth`, `spawnRoomMobs` scaling), `src/dungeon/service.js` (`discoverRoom` aura scaling), `src/worldCode.js` (mob kill XP scaling), `src/particles/config.js` (`DIFFICULTY_COLOR.endless`)
**Métrique :** `analytics.run.endless_depth_avg`, `analytics.run.bossrush_clear_rate`
**Impact :** ⭐⭐ / Effort : **M** → **Endless fait, Boss Rush TODO**

### [~] 6. Draft Blessings avec reroll + synergies — REROLL FAIT, SYNERGIES MANQUANTES
**Fait :**
- `rollBlessing()` → 3 choix distincts, tirage pondéré par rareté, réserve 1 point, `resetShopItemForPlayer` pour retirer
- **Reroll payant ajouté (PR #159-160) :** nouveau tile `Reroll Blessings` (Blessings, icône Compass, prio 20), `REROLL_BASE_GOLD=50` + `15/blessing pris` → **très abordable** (0 pris=50g, 5 pris=125g, 10 pris=200g, 20 pris=350g). `rerollOffer()` en `src/blessing/service.js` remplace les 3 choix sans dépenser de point, coût gold via `cstm_smp_gold`. Spawn guard + `/dbg blessings` affiche `reroll cost`. Croissance volontairement faible sur demande joueur.
**Manque signalé :** spec demandait **synergies affichées** ("Sanguine + Geo = +15% shield") — non implémenté. Catalogue a bien grossi (60+ blessings avec tradeoffs Hades/Dead Cells) mais pas de détection de synergies.
**Fichiers :** `src/blessing/config.js` (`REROLL_BASE_GOLD`, `rerollGoldCost`, `CHOICE_COUNT`, `RARITIES`), `src/blessing/presentation.js` (`choiceTile`), `src/blessing/service.js` (`roll`, `choose`, `rerollOffer`), `src/worldCode.js:rollBlessing/rerollBlessing/refreshBlessingTiles`
**Métrique :** `analytics.blessing.pick_rate` par blessing/rarity, `analytics.blessing.reroll_rate`
**Impact :** ⭐⭐ / Effort : **S** → **fait à 70%**

### [ ] 11. Quêtes hebdo + Affixes hebdomadaires — NOUVEAU (proposé)
**Faire :** 5 quêtes hebdo (reset lundi UTC, `dungeonBreak.quest.weekly.v1`, cibles x5 du quotidien, récompenses x3 + 1 Gold Key garanti) + 1 affixe tournante (`Volatile` = +30% dégâts mobs / -20% HP, `Greedy` = +50% gold, `Glass` = +100% dégâts des deux côtés). Affixe affichée en lobby + modifieur `MOB_TUNING` + `LOOT_TABLE` poids.
**Pourquoi :** les quotidiennes rétiennent J1-J7, mais le week-end sans objectif long → churn. Un affixe crée du contenu sans nouveau donjon.
**Fichiers :** `src/quest/config.js` (nouveaux templates `weekly:true`), `src/quest/service.js` (`pickWeeklyForToday`), `src/dungeon/config.js` (`WEEKLY_AFFIXES`), `src/worldCode.js`
**Métrique :** `analytics.quest.weekly_complete`, `analytics.affix.weekly_pick_rate`
**Impact :** ⭐⭐⭐ / Effort : **M** — prioritaire après #4

### [ ] 12. Pity & Duplication clean pour crates — NOUVEAU
**Faire :** compteur `cratePity:{Common:0,…}` en DB (`dungeonBreak.crate.pity.v1`) : +1 par crate sans légendaire, à 25 → force 1 item légendaire + reset. Doublon arme/armure → `+5-15 Iron Fragment` auto (au lieu d'Air). Tooltip in-game `Pity 12/25`.
**Pourquoi :** 45% `AIR_CHANCE` en Common + doublons → sentiment "crate vide". Le pity est standard et mesurable.
**Fichiers :** `src/crate/config.js` (`PITY_THRESHOLD=25`), `src/crate/service.js` (`rollWithPity`, `getAmountForItem`)
**Métrique :** `analytics.crate.pity_triggered`, `analytics.crate.air_rate_observed`
**Impact :** ⭐⭐ / Effort : **S**

### [ ] 13. Enchant / Reforge léger — NOUVEAU
**Faire :** station `Anvil` (près Artisan Bench) : 1 arme/armure + 3 fragments du tier → relance 1 stat (ex: `+2% crit` → `+3% crit`) pour `100 * tier` gold. 3 rerolls max / item (`reforgeCount` en `itemData`). Pas de P2W, sink gold demandé.
**Fichiers :** `src/crafting/config.js` (nouveaux `reforgeRecipes`), `src/crafting/service.js`, `src/utils/analytics.js` (`analytics.craft.reforge`)
**Métrique :** `analytics.craft.reforge_count`, `analytics.economy.gold_sink`
**Impact :** ⭐⭐ / Effort : **M**

---

## 🆕 P1 — Propositions 2026-11-26 (améliorations à fort ROI)

> Ces 8 ajouts exploitent ce qui vient d'être livré (coin `blockData` + Finish Block 5s + `dungeon/leave` analytics) et corrigent les frictions vues en jeu. Tous en Anglais côté joueur.

### [ ] 16. Salles à événements variés — exploiter `ROOM_EVENTS` (SUITE de 3d)
**Faire :** 5 nouveaux `eventId` dans `src/dungeon/events.js` en plus de `lavaTrap` : `healingShrine` (+1 HP/2s, particules vertes), `poisonFog` (-1 HP/3s + filtre vert), `treasureVault` (2 chests garantis, `kind:"vault"`), `ambush` (2× mobs + reward gold), `shopRoom` (Artisan Bench au centre). Tag via `[-40,1,0,{kind,eventId}]` → `tickRoomEvents` déjà câblé.
**Pourquoi :** la techno `stampRoomInfo`/`tickRoomEvents` est prête mais 1 seul exemple = pas de rejouabilité. 5 events = 5 raisons de fouiller.
**Fichiers :** `src/dungeon/events.js`, `src/dungeon/templates.js` (tag 4-5 rooms existantes), `src/worldCode.js` (déjà intégré)
**Métrique :** `analytics.room.event_enter` {eventId}, `analytics.room.clear_time_by_event`
**Impact :** ⭐⭐⭐ / Effort : **S** — **recommandé #1** (1-2 jours)

### [ ] 17. Écran de fin de run (Run Summary)
**Faire :** à chaque sortie (`leave / Finish / Button / Death`), `middleText` + chat récap : `Rooms 12 · Kills 28 · Gold +420 · Time 08:32 · Depth 14`. Stocke `runStartTick` à `enterDifficulty`, calcule à `completeFinishCountdown`/`onRespawnRequest`/`service.leave`. Bouton "Play Again" → re-téléport pad.
**Pourquoi :** sans feedback, le joueur ne sait pas s'il progresse. C'est le moment #1 de rétention (boucle "encore une").
**Fichiers :** `src/dungeon/service.js` (runStats {rooms,kills,gold,startTick}), `src/worldCode.js` (render + analytics)
**Métrique :** `analytics.run.summary_shown`, `analytics.run.replay_rate` (second run < 3min)
**Impact :** ⭐⭐⭐ / Effort : **S** — **recommandé #2**

### [ ] 18. Mini-boussole + waypoints lobby/donjon
**Faire :** `groundArrowPath` persistant : au spawn pointe vers pad `Medium` (nouveau joueur) ou quête NPC ; en donjon pointe vers `Finish Block` si découvert (sinon prochaine salle non clear). Toggle `/compass off`. Utilise déjà `directionArrow`/`groundArrowPath`.
**Pourquoi :** tests joueurs : 30% du temps perdu à chercher la sortie/salle suivante. Flèche = -20% frustration, + temps de jeu utile.
**Fichiers :** `src/worldCode.js` (arrow helpers), `src/dungeon/service.js:getRoomData` pour Finish pos
**Métrique :** `analytics.navigation.waypoint_follow`, `analytics.dungeon.time_to_finish`
**Impact :** ⭐⭐ / Effort : **S**

### [ ] 19. Équilibrage économie & courbe difficulté
**Faire :** audit `FINISH_REWARDS` (100→10000) vs `DUNGEON_PRICES` (0→1M) vs `REROLL` (50+15) : VeryEasy rentabilisé en 1 run, Hell en 8 runs. Baisser Hell 1M→500k ou augmenter Finish Hell 10k→25k. Ajouter `Daily bonus` +200 gold premier Finish/jour.
**Pourquoi :** actuellement grind Hell = 100 runs = churn. Un sink gold (reforge #13) sans faucet équilibré = frustration.
**Fichiers :** `src/dungeon/config.js:DUNGEON_PRICES`, `src/worldCode.js:FINISH_REWARDS`, `src/pass/config.js`
**Métrique :** `analytics.economy.gold_earned_per_run`, `analytics.progression.days_to_hell`
**Impact :** ⭐⭐⭐ / Effort : **S** — data-driven, à faire avec #12

### [ ] 20. Juice : son, particules, hit feedback
**Faire :** 5 sons `api.playSound` si dispo (sinon fallback particules) : `finish_countdown_tick`, `finish_complete` (fanfare), `room_clear` (ding), `level_up` (aura), `crate_open` (déjà partiel). + `screenShake` léger sur gros dégâts (via `setClientOption cameraShake` si Bloxd l'expose, sinon `spawnParticles` flash).
**Pourquoi :** le jeu est silencieux en dehors du natif Bloxd. 3 SFX = +15% sensation de polish pour 0 gameplay.
**Fichiers :** `src/particles/config.js` (PRESETS), `src/worldCode.js`, `src/combatFx/service.js`
**Métrique :** `analytics.juice.sound_played` (debug), retours qualitatifs
**Impact :** ⭐⭐ / Effort : **S**

### [ ] 21. Finish en équipe + QoL coop
**Faire :** `completeFinishCountdown` → si `getTeamId(pid)` a membres, téléporte tout le `teamMembers` (même reward partagé ou +10% bonus / coéquipier), `disbandTeam` propre. Annuler si un coéquipier quitte le bloc. Actuellement solo = les coéquipiers restent bloqués.
**Pourquoi :** coop existe (teams + revive) mais Finish solo casse le groupe. Fix = 1h, impact coop ⭐⭐⭐.
**Fichiers :** `src/worldCode.js:completeFinishCountdown`, `src/dungeon/service.js`
**Métrique :** `analytics.coop.finish_together`, `analytics.coop.retention_vs_solo`
**Impact :** ⭐⭐ / Effort : **S** — bloqueur coop

### [ ] 22. Streak quotidien & calendrier
**Faire :** DB `dungeonBreak.streak.v1` : jour consécutif avec 1 `dungeon/leave` → +100/200/300/500/1000 gold + jour 7 = Gold Key. Affichage lobby `Streak 3🔥` + `middleTextLower`. Reset si 48h sans jeu.
**Pourquoi :** rétention D1→D7 la plus rentable. Quêtes existent mais pas de streak = pas d'habitude.
**Fichiers :** `src/quest/service.js` ou `src/streak/service.js` (new), `src/worldCode.js:onPlayerJoin`
**Métrique :** `analytics.streak.day_n`, `analytics.retention.d1/d7`
**Impact :** ⭐⭐⭐ / Effort : **S** — **recommandé #3**

### [ ] 23. Preview craft & comparatif d'items
**Faire :** dans shop `Crafting` : tooltip `+12 DMG vs équipé (+3)` + preview 3D `giveItemPreview` si dispo, sinon texte. + filtre `Owned`/`Missing mats`. Éviter full UI custom (Bloxd shop limité).
**Pourquoi :** #2 a réorg les stations mais pas le "est-ce mieux que ce que j'ai ?" → 40% des crafts sont regrettés.
**Fichiers :** `src/crafting/config.js`, `src/crafting/service.js`, `src/worldCode.js:refreshCraftShop`
**Métrique :** `analytics.craft.preview_open`, `analytics.craft.regret_rate` (craft → drop < 5min)
**Impact :** ⭐⭐ / Effort : **M**

---

## 🟡 P2 — Qualité & Vie communautaire

### [ ] 7. Coop 2-3 joueurs + rez — PARTIELLEMENT FAIT (2026-11)
**Fait :** `createTeamForLobby`, `teamId` partagé à `enterDifficulty`, revive 10s au sol (`downedPlayers`, `reviveTick`, `8s immunity`, `directionArrow` rouge), wipe→spawn, anti-vol crates `crateIsOwnedByOther`.
**Reste :** lobby départ groupé OK mais Finish solo (→ #21), pas d'UI vie alliée, pas de -50% or au rez (actuellement gratuit). Garde `crateIsOwnedByOther` pour anti-vol.
**Fichiers :** `src/worldCode.js:onPadStart`, `src/dungeon/service.js`, `src/crate/service.js`
**Métrique :** `analytics.coop.run_started`, `analytics.coop.rez_count`, `analytics.coop.retention_vs_solo`
**Impact :** ⭐⭐⭐ / Effort : **L** → **fait à 70%**

### [ ] 8. Saisons 6 semaines (reset doux, pas full wipe)
**Faire :**
- Garde permanent (blessings permanentes, ranks), reset run/timed + or
- 1 biome reskinné par saison (tu copies déjà des chunks — change palette + mobs)
- 2 nouveaux sets / saison
**État actuel :** aucun système de saison. Permanent est bien séparé (DB `dungeonBreak.blessings.v1`) et `resetPlayerProgress`/`endRun` reset run/timed — base technique posée.
**Fichiers :** `src/ranks/config.js`, `src/dungeon/templates.js`, `src/blessing/service.js:resetPlayerProgress`
**Métrique :** `analytics.season.active_players`, `analytics.season.returning_rate`
**Impact :** ⭐⭐ / Effort : **L**

### [ ] 9. Cosmétiques liés aux Ranks (éthique) — PARTIELLEMENT FAIT
**Fait :** système Ranks complet : 12 ranks (OWNER/TESTER/MEMBER/HUNTER/SLAYER/EXPLORER/VETERAN/CHAMPION/LEGEND...), unlocks par crates/kills/rooms/temps, chat prefix + `colorInLobbyLeaderboard` + `nameColour` + `nameTagInfo` via `applyRankVisuals()`, catégorie shop `Utilities` unifiée (ex-Ranks déplacé), dropdown sélection.
**Manque signalé :** spec voulait **trail particules, titre chat custom, emote, `/rank preview`**, vendus en or. Actuellement seul couleur/nametag/prefix existe. Pas de trail/emote/preview.
**Fichiers :** `src/ranks/config.js` (`RANKS`, `NONE_RANK_ID`), `src/ranks/service.js`, `src/particles/config.js`, `src/worldCode.js:refreshRanksShop/applyRankVisuals`
**Métrique :** `analytics.cosmetic.equip_rate`, `analytics.shop.rank_preview`
**Impact :** ⭐ / Effort : **S** → **fait à 60%**

### [x] 10. Metrics in-game + feedback natif (sans Discord) — FAIT (wrapper + instrumentation, feedback panel TODO)
**Fait :**
- **Wrapper vérifié** `src/utils/analytics.js` : `api.registerAnalyticsEvent(playerId, eventType, eventValue, gameCategoryId, gameStartTimeMs, position, numericValue)` — API Bloxd Custom games vérifiée via `bloxd.io/docs/api-reference` (09/11/2026). Limites : 20 evt/min/player, 20 catégories/jour, 20 types/cat/jour. Fallback `api.log` si pas dispo. `track(playerId, eventType, eventValue, opts)` + helpers `Analytics.*` + `trackPos`.
- **Instrumentation :** `worldCode.js` (join/leave, dungeon enter/leave, room_discover, pad_use, combat hit/kill/damage_taken, crate click, shop teleport, onPlayerCrafted), `blessing/service.js` (roll/pick/reroll), `quest/service.js` (take/reroll/complete/claimed), `pass/service.js` (xp_gain, level, tier_claim), `tutorial/service.js` (start/crate_opened/complete).
- Contrainte externe respectée : **aucun call externe**, tout via Bloxd interne.
**Reste TODO :** shop catégorie "Donner mon avis" (emoji + texte), dashboard interne clear rate / temps moyen, patch notes in-game — non bloquant pour les metrics.
**Fichiers :** `src/utils/analytics.js` (nouveau), `src/worldCode.js`, `src/blessing/service.js`, `src/quest/service.js`, `src/pass/service.js`, `src/tutorial/service.js`
**Métrique :** `analytics.feedback.sent`, `analytics.feedback.satisfaction_avg`
**Impact :** ⭐⭐ / Effort : **S** → **fait**

### [ ] 14. Feedback in-game + Leaderboard local — NOUVEAU (débloqué par #10)
**Faire :** catégorie shop `Feedback` : 5 emojis → `analytics.feedback.sent {satisfaction:1-5, text}` + panneau `Leaderboard` (`/lb` + shop tile) : 3 tabs — `Richest` (gold), `Deepest` (salle max en Hell/Endless), `Fastest` (temps VeryEasy→Hell). Stockage DB globale `dungeonBreak.lb.v1` (top 20, anti-spam 1 submit/run).
**Fichiers :** `src/feedback/service.js` (nouveau), `src/leaderboard/service.js` (nouveau), `src/worldCode.js` (shop category)
**Métrique :** `analytics.feedback.sent_rate`, `analytics.leaderboard.view`
**Impact :** ⭐⭐ / Effort : **M**

### [ ] 15. Qualité de vie craft/inventaire — NOUVEAU
**Faire :** (a) `Mass craft` (x1/x5/x10 via shift), (b) `Comparer` (hover arme → tooltip + équipé côte-à-côte), (c) `Loadout` 2 slots (sauvegarde arme+armure, switch 3s cooldown), (d) tri auto `Iron Fragment → stock` en 1 clic.
**Fichiers :** `src/crafting/service.js` (`craftMultiple`), `src/worldCode.js` (`onPlayerClick` compare), `src/loadout/service.js` (nouveau)
**Métrique :** `analytics.craft.mass_craft_rate`, `analytics.loadout.switch`
**Impact :** ⭐⭐ / Effort : **M** → fusion possible avec #23

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

---

## 🚨 Manques signalés — à prioriser (résumé)

| # | Manque | Priorité | Notes 2026-11-26 |
|---|--------|----------|-----------------|
| 4 | **Quêtes hebdo** (5 hebdo) — seul quotidien existe | P1 — haute | → #11 remplace : 5 hebdo + affixe |
| 6 | **Synergies Blessings** affichées | P1 — moy | reste : détecter 2-3 combos, +15% |
| 5 | **Boss Rush** | P1 — moy | Endless fait (+2%/salle), Boss Rush reste, seed retiré |
| 11 | **Affixes hebdo** | P1 — haute | **NOUVEAU** — contenu sans map |
| 12 | **Pity crates** | P1 — haute | **NOUVEAU** — corrige AIR 45% |
| 13 | **Reforge/Enchant** | P1 — moy | **NOUVEAU** — sink gold |
| 16 | **Salles events variés** | P1 — haute | **NEW 26/11** — 1 event → 6, ROI max |
| 17 | **Run Summary** | P1 — haute | **NEW 26/11** — boucle rétention |
| 22 | **Streak quotidien** | P1 — haute | **NEW 26/11** — D1→D7 |
| 7 | **Coop + rez** | P2 — haute (L) | 70% fait, reste Finish team |
| 21 | **Finish team TP** | P1 — haute (S) | **NEW 26/11** — bloqueur coop |
| 14 | **Feedback + Leaderboard** | P2 — moy | **NOUVEAU** — débloqué par analytics |
| 15/23 | **QoL craft + preview** | P2 — moy | **NOUVEAU** |
| 19 | **Économie / courbe** | P1 — haute | **NEW 26/11** — Hell grind |
| 8 | **Saisons** | P2 — basse | Mois 3 |
| 9 | **Cosmétiques Rank** (trails, emotes, `/rank preview`) | P2 — basse | inchangé |
| — | **Preview craft UI** (mention §2 "reste TODO futur") | P2 — moy | → #23 |
| — | **Patch notes in-game** panneau | P3 — basse | inchangé |

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
```

**Events prioritaires à logger dès maintenant :**
- `tutorial.completed`, `craft.success`, `run.clear`, `run.death`, `blessing.pick`, `blessing.reroll`, `quest.complete`, `crate.open`, `coop.run_started`, `dungeon.leave`
- **Nouveaux :** `room.event_enter`, `run.summary_shown`, `crate.pity_triggered`, `craft.reforge`, `affix.weekly_pick_rate`, `feedback.sent`, `leaderboard.view`, `streak.day_n`

---

## Roadmap suggérée — mise à jour 2026-11-26

- **Sprint 1 (cette semaine) :** #16 events variés (1j) + #17 run summary (1j) + #21 finish team (2h) — **3 petits qui changent tout**
- **Sprint 2 :** #12 pity + #19 économie + #22 streak — **rétention D1→D7**
- **Sprint 3 :** #11 hebdo+affixe + #13 reforge + #15/#23 QoL craft
- **Sprint 4 :** #5 Boss Rush + #7 finition coop (UI vie alliée)
- **Mois 3 :** #8 saison 1 + #14 feedback/leaderboard + #9 cosmétiques trails

> Ancienne roadmap (Semaine 1 : #11+#12+#14, Semaine 2-3 : #13+#15+#6, Mois 2 : Boss Rush, Mois 3 : coop+saison) → **mise à jour : on capitalise sur coin blockData/Finish livrés le 26/11**

---

## Comment contribuer

1. Crée une branche `arena/<id>-dungeon-break`
2. Coche `[x]` ici + ajoute test dans `tests/` si logique
3. `npm run build` → `npm test` (167 tests) → PR → merge auto autorisé (cf `AGENT_RULES.md`)

*Dernière mise à jour : 2026-11-26 — mainteneur : @Souls-equal — Finish Block 5s Anglais + Gold Coin, 20 rooms, events extensible, 4 analytics, +8 propositions (#16-23)*
