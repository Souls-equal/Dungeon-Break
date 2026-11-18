/**
 * Crafting service — hides all non-modded crafts, then re-exposes
 * only modded crafts + essential vanilla crafts (armors/weapons).
 * Called from onPlayerJoin for each player (per-player recipes).
 */

import { CRAFTS } from "./config.js";
import { VANILLA_CRAFTS } from "./vanilla.js";
import { setTimeout as scheduleTimeout } from "../utils/scheduler.js";

export function registerCraftingRecipes(api, playerId) {
  if (!api || !playerId) return 0;
  if (typeof api.editItemCraftingRecipes !== "function") {
    try { api.log("[Crafting] editItemCraftingRecipes not available"); } catch (_) {}
    return 0;
  }
  // 1) Hide all non-modded crafts so the player isn't overwhelmed
  //    api.removeItemCraftingRecipes(playerId, null) = remove all
  try {
    if (typeof api.removeItemCraftingRecipes === "function") {
      api.removeItemCraftingRecipes(playerId, null);
    }
  } catch (e) {
    try { api.log(`[Crafting] hide all failed: ${e && e.message ? e.message : e}`); } catch (_) {}
  }

  let ok = 0;
  // 2) Group by result to avoid overwriting: single call per item with all variants
  //    Combine VANILLA (base armors/weapons) + CRAFTS (shards -> materials -> custom armors)
  const ALL = [...VANILLA_CRAFTS, ...CRAFTS];
  const byResult = new Map();
  for (const craft of ALL) {
    if (!craft || !craft.result) continue;
    const key = craft.result;
    if (!byResult.has(key)) byResult.set(key, []);
    byResult.get(key).push({
      requires: craft.requires,
      produces: craft.produces ?? 1,
      station: craft.station ?? "Workbench",
    });
  }
  const entries = [...byResult.entries()];
  // Bloxd limits calls per tick — batch over ticks to avoid "invalid item recipes" spam on rejoin
  let index = 0;
  const BATCH = 20;
  function flushBatch() {
    for (let batchCount = 0; batchCount < BATCH && index < entries.length; batchCount += 1, index += 1) {
      const [result, recipes] = entries[index];
      try {
        api.editItemCraftingRecipes(playerId, result, recipes);
        ok += 1;
      } catch (e) {
        // Fallback: try Workbench if Artisan Bench failed, and simplify requires
        let recovered = false;
        try {
          const fallback = recipes.map(r => ({
            requires: r.requires,
            produces: r.produces ?? 1,
            station: "Workbench",
          }));
          api.editItemCraftingRecipes(playerId, result, fallback);
          ok += 1; recovered = true;
        } catch (_) {}
        if (!recovered) {
          try {
            const simple = recipes.map(r => ({
              requires: r.requires.slice(0,1),
              produces: r.produces ?? 1,
              station: "Workbench",
            }));
            api.editItemCraftingRecipes(playerId, result, simple);
            ok += 1; recovered = true;
          } catch (_) {}
        }
        if (!recovered) {
          try { api.log(`[Crafting] failed ${result}: ${e && e.message ? e.message : e}`); } catch (_) {}
        }
      }
    }
    if (index < entries.length) {
      try { scheduleTimeout(flushBatch, 1); } catch (_) { /* scheduler not ready — flush synchronously */ while (index < entries.length) { const [r, rec] = entries[index++]; try { api.editItemCraftingRecipes(playerId, r, rec); ok+=1; } catch(_){} } }
    }
  }
  flushBatch();
  return ok;
}

// For debug: list crafts for a material
export function craftsForMaterial(materialName) {
  return [...VANILLA_CRAFTS, ...CRAFTS].filter((c) => c.requires && c.requires.some((r) => r.items && r.items.includes(materialName)));
}
export function craftsForResult(resultName) {
  return [...VANILLA_CRAFTS, ...CRAFTS].filter((c) => c.result === resultName);
}
