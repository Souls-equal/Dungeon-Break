/**
 * Crafting service — hides all non-modded crafts, then re-exposes
 * only modded crafts + essential vanilla crafts (armors/weapons).
 * Called from onPlayerJoin for each player (per-player recipes).
 */

import { CRAFTS } from "./config.js";
import { VANILLA_CRAFTS } from "./vanilla.js";

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
  for (const [result, recipes] of byResult) {
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
  return ok;
}

// For debug: list crafts for a material
export function craftsForMaterial(materialName) {
  return [...VANILLA_CRAFTS, ...CRAFTS].filter((c) => c.requires && c.requires.some((r) => r.items && r.items.includes(materialName)));
}
export function craftsForResult(resultName) {
  return [...VANILLA_CRAFTS, ...CRAFTS].filter((c) => c.result === resultName);
}
