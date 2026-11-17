/**
 * Crafting service — enregistre tous les crafts custom via api.editItemCraftingRecipes
 * Appelé depuis onPlayerJoin pour chaque joueur (per-player recipes).
 */

import { CRAFTS } from "./config.js";

export function registerCraftingRecipes(api, playerId) {
  if (!api || !playerId) return 0;
  if (typeof api.editItemCraftingRecipes !== "function") {
    try { api.log("[Crafting] editItemCraftingRecipes not available"); } catch (_) {}
    return 0;
  }
  let ok = 0;
  // Groupe par result pour éviter d'écraser: une seule call par item avec toutes ses variantes
  const byResult = new Map();
  for (const craft of CRAFTS) {
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
  return CRAFTS.filter((c) => c.requires && c.requires.some((r) => r.items && r.items.includes(materialName)));
}
export function craftsForResult(resultName) {
  return CRAFTS.filter((c) => c.result === resultName);
}
