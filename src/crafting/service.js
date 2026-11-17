/**
 * Crafting service — cache tous les crafts non-moddés, puis ré-expose
 * uniquement les crafts moddés + les crafts vanilla essentiels (armures/armes).
 * Appelé depuis onPlayerJoin pour chaque joueur (per-player recipes).
 */

import { CRAFTS } from "./config.js";
import { VANILLA_CRAFTS } from "./vanilla.js";

export function registerCraftingRecipes(api, playerId) {
  if (!api || !playerId) return 0;
  if (typeof api.editItemCraftingRecipes !== "function") {
    try { api.log("[Crafting] editItemCraftingRecipes not available"); } catch (_) {}
    return 0;
  }
  // 1) Cacher tous les crafts non-moddés pour ne pas perdre le joueur
  //    api.removeItemCraftingRecipes(playerId, null) = remove all
  try {
    if (typeof api.removeItemCraftingRecipes === "function") {
      api.removeItemCraftingRecipes(playerId, null);
    }
  } catch (e) {
    try { api.log(`[Crafting] hide all failed: ${e && e.message ? e.message : e}`); } catch (_) {}
  }

  let ok = 0;
  // 2) Groupe par result pour éviter d'écraser: une seule call par item avec toutes ses variantes
  //    On combine VANILLA (armures/armes de base) + CRAFTS (shards -> matériaux -> armures custom)
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
      try { api.log(`[Crafting] failed ${result}: ${e && e.message ? e.message : e}`); } catch (_) {}
    }
  }
  return ok;
}

// Pour debug: liste les crafts d'un set
export function craftsForMaterial(materialName) {
  return [...VANILLA_CRAFTS, ...CRAFTS].filter((c) => c.requires && c.requires.some((r) => r.items && r.items.includes(materialName)));
}
export function craftsForResult(resultName) {
  return [...VANILLA_CRAFTS, ...CRAFTS].filter((c) => c.result === resultName);
}
