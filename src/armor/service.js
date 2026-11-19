/**
 * armor/service.js — centralized armor ability system (13 sets × 5 levels)
 * Integrates with combat: onDamaged, onDealingDamage, onMobKilled, tick
 */

import { ARMOR_SETS, ARMOR_IDS, armorLevelForCount, getLevelDef, getArmorDescriptionForCount } from "./config.js";
import { PRESETS } from "../particles/config.js";
import { setTimeout as scheduleTimeout } from "../utils/scheduler.js";

let globalTick = 0;
export function _setTick(v){ globalTick=v|0; }
export function _advanceTick(){ globalTick++; }
export function _getTick(){ return globalTick; }

function keyOf(id){ return String(id); }

// Helpers
function posOf(api, eid, fallback){
  try{ const p=api.getPosition(eid); if(Array.isArray(p)&&p.length>=3) return p; }catch(_){}
  return fallback||null;
}
function playerPos(api,pid){ try{ const p=api.getPosition(pid); if(Array.isArray(p)&&p.length>=3) return p;}catch(_){} return null; }
function mobPos(api,mid,fallback){ return posOf(api,mid,fallback); }
function flyingMsg(api, pid, parts, icon){
  try{ if(typeof api.sendFlyingMiddleMessage!=="function") return; const msg=[...parts]; if(icon) msg.push({icon}); api.sendFlyingMiddleMessage(pid,msg,50,700);}catch(_){}
}
function spawnPreset(api,pos,presetFn){
  if(!api||!pos||typeof api.playParticleEffect!=="function") return;
  try{ const P=globalThis.__PARTICLE_PRESETS?.PRESETS; if(!P) return; const preset=presetFn(P); if(!preset) return; const r=0.6,h=0.8; api.playParticleEffect({...preset,pos1:[pos[0]-r,pos[1],pos[2]-r],pos2:[pos[0]+r,pos[1]+h,pos[2]+r],dir1:[-1,-1,-1],dir2:[1,1,1]});}catch(_){}
}
function spawnAt(api,pos,key,extra={}){
  if(!api||!pos) return;
  try{ const P=globalThis.__PARTICLE_PRESETS?.PRESETS; if(!P||!P[key]) return; const preset=P[key](); const r=extra.radius??0.6,h=extra.height??0.8; const dir1=extra.dir1||[-1,-1,-1],dir2=extra.dir2||[1,1,1];
    // try shared helper
    try{ const { spawn }= globalThis.__PARTICLE_HELPERS||{}; if(spawn) { spawn(api,pos,preset,{radius:r,height:h,dir1,dir2}); return; }}catch(_){}
    api.playParticleEffect({...preset,pos1:[pos[0]-r,pos[1],pos[2]-r],pos2:[pos[0]+r,pos[1]+h,pos[2]+r],dir1,dir2});
  }catch(_){}
}
function spawnZone(api,pos,key,radius=2,height=0.3){
  if(!api||!pos) return;
  try{ const P=globalThis.__PARTICLE_PRESETS?.PRESETS; if(!P||!P[key]) return; const preset=P[key](); const r=radius,h=height;
    api.playParticleEffect({...preset,pos1:[pos[0]-r,pos[1],pos[2]-r],pos2:[pos[0]+r,pos[1]+h,pos[2]+r],dir1:[-0.6,0.2,-0.6],dir2:[0.6,0.6,0.6]});
  }catch(_){}
}
function nearbyMobs(api, center, radius){
  const out=[]; if(!api||!center) return out;
  try{
    if(typeof api.getEntitiesInRect==="function"){
      const min=[center[0]-radius,center[1]-radius,center[2]-radius],max=[center[0]+radius,center[1]+radius,center[2]+radius];
      const ids=api.getEntitiesInRect(min,max)||[];
      for(const id of ids){
        try{ if(typeof api.getEntityType==="function"&&api.getEntityType(id)==="Player") continue;}catch(_){}
        try{ const p=api.getPosition(id); if(!p) continue; const dx=p[0]-center[0],dy=p[1]-center[1],dz=p[2]-center[2]; if(dx*dx+dy*dy+dz*dz<=radius*radius+4) out.push({id,pos:p});}catch(_){}
      }
      return out;
    }
  }catch(_){}
  try{ if(typeof api.getMobIds==="function"){ const ids=api.getMobIds()||[]; for(const id of ids){ try{ const p=api.getPosition(id); if(!p) continue; const dx=p[0]-center[0],dy=p[1]-center[1],dz=p[2]-center[2]; if(dx*dx+dy*dy+dz*dz<=radius*radius+4) out.push({id,pos:p});}catch(_){}} } }catch(_){}
  return out;
}
function applyEffectSafe(api,eid,name,dur,level=1){
  try{ if(typeof api.applyEffect==="function") api.applyEffect(eid,name,dur,{inbuiltLevel:level}); }catch(_){}
}
function damageMob(api,mobId,amt,attackerId){
  if(!api||!mobId||!Number.isFinite(amt)||amt<=0) return false;
  const dmg=Math.max(1,Math.round(amt));
  try{
    if(typeof api.applyHealthChange==="function"){
      try{ const r=api.applyHealthChange(mobId,-dmg,attackerId||undefined,true); if(r) return r; }catch(_){}
      try{ const r=api.applyHealthChange(mobId,-dmg,attackerId?{lifeformId:attackerId}:undefined,true); if(r) return r; }catch(_){}
    }
    if(typeof api.attemptApplyDamage==="function"&&attackerId) try{ return api.attemptApplyDamage({eId:attackerId,hitEId:mobId,attemptedDmgAmt:dmg}); }catch(_){}
  }catch(_){}
  return false;
}
function healPlayer(api,pid,amt){
  if(!api||!pid||!Number.isFinite(amt)||amt<=0) return;
  const heal=Math.max(1,Math.round(amt));
  try{ if(typeof api.applyHealthChange==="function"){ api.applyHealthChange(pid,heal,undefined,false); return; }
    if(typeof api.setHealth==="function"&&typeof api.getHealth==="function"){ const cur=api.getHealth(pid); const max=typeof api.getMaxHealth==="function"?api.getMaxHealth(pid):null; if(Number.isFinite(cur)){ api.setHealth(pid, max?Math.min(max,cur+heal):cur+heal); } }
  }catch(_){}
}
function shieldAdd(api,pid,add,cap){
  if(!api||!pid) return;
  try{ const cur=typeof api.getShieldAmount==="function"?api.getShieldAmount(pid):0; const n=Math.min(cap??20, (Number.isFinite(cur)?cur:0)+add); if(typeof api.setShieldAmount==="function") api.setShieldAmount(pid,n); }catch(_){}
}
function shieldGet(api,pid){ try{ const v=typeof api.getShieldAmount==="function"?api.getShieldAmount(pid):0; return Number.isFinite(v)?v:0; }catch(_){ return 0; } }
function healthRatio(api,pid){
  try{ const cur=typeof api.getHealth==="function"?api.getHealth(pid):null; const max=typeof api.getMaxHealth==="function"?api.getMaxHealth(pid):null; if(Number.isFinite(cur)&&Number.isFinite(max)&&max>0) return cur/max; }catch(_){}
  return 1;
}

// Armor counting
const ARMOR_SLOTS = [47,48,49,50,51];
const FALLBACK_SLOTS = [36,37,38,39,40]; // some Bloxd versions
export function getArmorCounts(api, playerId){
  const counts=new Map();
  if(!api||!playerId||typeof api.getItemSlot!=="function") return counts;
  const seen=new Set();
  for(const slot of [...ARMOR_SLOTS, ...FALLBACK_SLOTS]){
    try{
      const it=api.getItemSlot(playerId, slot);
      if(!it||!it.name||it.name==="Air") continue;
      const name=String(it.name).split("|")[0].trim();
      // parse set name: longest prefix match from ARMOR_SETS keys
      let matched=null;
      for(const setId of Object.keys(ARMOR_SETS).sort((a,b)=>b.length-a.length)){
        if(name.startsWith(setId+" ")){ matched=setId; break; }
      }
      if(!matched) continue;
      // avoid double counting same item name in fallback duplicate slots? Use item+slot uniqueness, but simplest: count each slot, fallback may duplicate -> dedupe by name+slot
      const key=`${slot}:${name}`;
      if(seen.has(key)) continue; seen.add(key);
      // Deduplicate if same armor piece appears in both primary and fallback slots? We'll count only primary if duplicate - but fallback only counted if primary not present? Simpler: if counts from primary already has 5, skip fallback.
      // For now count all, but if duplicate counting, fallback slots that duplicate primary names will double count. To avoid, we check if slot is fallback and we already counted same name in primary slots -> skip.
      if(FALLBACK_SLOTS.includes(slot)){
        // if we already counted this name in primary, skip
        let already=false;
        for(const s of ARMOR_SLOTS){ try{ const it2=api.getItemSlot(playerId,s); if(it2&&it2.name&&String(it2.name).split("|")[0].trim()===name) already=true; }catch(_){} }
        if(already) continue;
      }
      counts.set(matched, (counts.get(matched)||0)+1);
    }catch(_){}
  }
  return counts;
}
export function getArmorLevel(api, playerId, setId){
  const counts=getArmorCounts(api,playerId);
  const n=counts.get(setId)||0;
  return armorLevelForCount(n);
}
export function getAllArmorLevels(api, playerId){
  const counts=getArmorCounts(api,playerId);
  const out={};
  for(const id of Object.keys(ARMOR_SETS)){
    const c=counts.get(id)||0;
    if(c>0) out[id]=armorLevelForCount(c);
  }
  return out;
}

// State per armor sets
const amethiteCooldown=new Map(); // pid -> tick
const magBurns=new Map(); // mobId -> {owner,dmg,ticksLeft,interval,nextTick,pos}
const rubelliteStacks=new Map(); // pid -> {level,lastKillTick,maxLevel,regenEndTick}
const serpentPoisons=new Map(); // mobId -> {owner,dmg,ticksLeft,interval,nextTick,pos,debuff}
const cursedMobs=new Map(); // mobId -> {owner,expireTick,dmgTakenMult,dmgDealtMult}
const kinglyAmethiteState=new Map(); // pid -> {uses,lastUseTick,buffUntil,buffMult,aoeBonus, explosionReady}
const kinglyDiamondLowCd=new Map(); // pid -> cooldownEnd
const spectralInvis=new Map(); // pid -> expireTick
const spectralSpeed=new Map(); // pid -> expire
const geoHits=new Map(); // pid -> hitCount
const geoMines=[]; // {pos,owner,explodeTick,dmg,radius,chain,chainRadius}
const astralGlowingArmor=new Map(); // mobId -> {owner,expireTick,extraMult}
const voltCharges=new Map(); // pid -> count
const voltDischargeCd=new Map(); // pid -> tick
const novaChargesArmor=new Map(); // pid -> count
const lastDamageTick=new Map(); // pid -> tick for cooldowns
const shieldBreakCd=new Map(); // pid -> tick

// Cooldown helper
function onCooldown(map,pid,cdTicks){
  const last=map.get(keyOf(pid))||-9999;
  return globalTick - last < cdTicks;
}
function setCooldown(map,pid){
  map.set(keyOf(pid), globalTick);
}

// --- Amethite wave ---
function tryAmethite(api,pid,levelDef,pos){
  const k=keyOf(pid);
  if(onCooldown(amethiteCooldown,pid, levelDef.cooldownTicks||30)) return;
  if(Math.random() > (levelDef.chance||0.15)) return;
  setCooldown(amethiteCooldown,pid);
  const dmg=levelDef.damage||6;
  const radius=levelDef.radius||2.5;
  const knock=levelDef.knock||0;
  const maxHits=levelDef.maxHits||1;
  // particles: charge converge then wave
  try{ spawnAt(api,pos,"amethiteCharge",{radius:0.4,height:0.8}); }catch(_){}
  try{ spawnZone(api,pos,"amethystZone",radius,0.4); }catch(_){}
  try{ spawnZone(api,pos,"amethiteWave",radius,0.4); }catch(_){}
  const nears=nearbyMobs(api,pos,radius);
  let hits=0;
  for(const {id, pos:mp} of nears){
    if(hits>=maxHits) break;
    try{ damageMob(api,id,dmg,pid); hits++; }catch(_){}
    if(knock>0){
      try{
        const dx=mp[0]-pos[0], dy=(mp[1]+0.5)-pos[1], dz=mp[2]-pos[2]; const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)||1;
        const vx=(dx/dist)*knock, vy=(dy/dist)*knock*0.5+0.3, vz=(dz/dist)*knock;
        if(typeof api.applyImpulse==="function") api.applyImpulse(id,vx,vy,vz);
        else if(typeof api.setVelocity==="function") api.setVelocity(id,vx,vy,vz);
      }catch(_){}
    }
  }
  if(hits>0) flyingMsg(api,pid,[{str:`Amethite Wave!`,style:{color:"#9B59B6"}},{str:` +${dmg}`} ],"Damage");
}

// Magmasteel burn apply
function applyMagBurn(api,pid,mobId,levelDef,mobPos){
  const burnDmg=levelDef.burnDmg||2;
  const dur=levelDef.burnDur||60;
  const interval=levelDef.burnInterval||20;
  magBurns.set(String(mobId),{owner:pid,dmg:burnDmg,ticksLeft:dur,interval,nextTick:globalTick+interval,pos:mobPos?[...mobPos]:null,mobId:String(mobId)});
  try{ spawnAt(api,mobPos,"magmaBurn",{radius:0.5,height:1.0}); }catch(_){}
}

// Serpentite poison
function applySerpentPoison(api,pid,mobId,levelDef,mobPos){
  const dmg=levelDef.poisonDmg||1;
  const dur=levelDef.poisonDur||60;
  const interval=levelDef.poisonInterval||20;
  serpentPoisons.set(String(mobId),{owner:pid,dmg,ticksLeft:dur,interval,nextTick:globalTick+interval,pos:mobPos?[...mobPos]:null,mobId:String(mobId),debuff:levelDef.debuff||0});
  try{ spawnAt(api,mobPos,"serpentPoison",{radius:0.5,height:0.8}); }catch(_){}
  if(levelDef.debuff>0){
    // store debuff via cursed-like? We'll store in separate poisonDebuff map but reuse serpentPoisons entry debuff
  }
}

// Cursemetal curse
function applyCurse(api,pid,mobId,levelDef){
  const expire=globalTick+ 200; // 10s
  cursedMobs.set(String(mobId),{owner:pid,expireTick:expire,dmgTakenMult:levelDef.dmgTakenMult||1, dmgDealtMult:levelDef.dmgDealtMult||1});
  try{ const mp=posOf(api,mobId,null); if(mp) spawnAt(api,mp,"curseApply",{radius:0.5,height:1.0}); }catch(_){}
}

// Lava check
function isInLava(api,pid){
  try{ const p=playerPos(api,pid); if(!p) return false; const b=api.getBlock(Math.floor(p[0]),Math.floor(p[1]),Math.floor(p[2])); if(b && String(b).toLowerCase().includes("lava")) return true;
    const b2=api.getBlock(Math.floor(p[0]),Math.floor(p[1]-0.5),Math.floor(p[2])); if(b2 && String(b2).toLowerCase().includes("lava")) return true;
  }catch(_){}
  return false;
}

// Public API: onDamaged (player receives hit)
export function onDamaged(api, playerId, attackerMobId, incomingDamage){
  const pid=playerId;
  const counts=getArmorCounts(api,pid);
  const pos=playerPos(api,pid) || posOf(api,attackerMobId,null) || [0,0,0];
  let modifiedDamage = incomingDamage;
  // For each equipped set, apply level effects
  for(const [setId, cnt] of counts){
    const lvl=armorLevelForCount(cnt);
    if(lvl<=0) continue;
    const def=getLevelDef(setId,lvl);
    if(!def) continue;
    // Amethite: chance wave on damage taken
    if(setId==="Amethite"){
      try{ tryAmethite(api,pid,def,pos); }catch(_){}
    }
    // Magmasteel: lava protection independent + burn chance
    if(setId==="Magmasteel"){
      if(isInLava(api,pid) && def.lavaResist>0){
        modifiedDamage = Math.max(0, Math.round(modifiedDamage * (1 - def.lavaResist)));
        if(def.lavaResist>0) try{ spawnAt(api,pos,"magmaLavaProtect",{radius:0.4,height:0.6}); }catch(_){}
      }
      if(attackerMobId && def.burnChance>0 && Math.random() < def.burnChance){
        const mp=posOf(api,attackerMobId,pos);
        applyMagBurn(api,pid,attackerMobId,def,mp);
      }
    }
    // Serpentite: poison chance on attacker
    if(setId==="Serpentite" && attackerMobId && def.poisonChance>0){
      if(Math.random() < def.poisonChance){
        const mp=posOf(api,attackerMobId,pos);
        applySerpentPoison(api,pid,attackerMobId,def,mp);
      }
    }
    // Cursemetal: curse chance
    if(setId==="Cursemetal" && attackerMobId && def.curseChance>0){
      if(Math.random() < def.curseChance) applyCurse(api,pid,attackerMobId,def);
    }
    // Kingly Diamond defense
    if(setId==="Kingly Diamond" && Number.isFinite(modifiedDamage) && def.defense>0){
      modifiedDamage = Math.max(1, Math.round(modifiedDamage * (1 - def.defense)));
      if(def.shieldConvert>0){
        const add=Math.max(1, Math.round(incomingDamage * def.shieldConvert));
        shieldAdd(api,pid,add,20);
        try{ spawnAt(api,pos,"kinglyDiamondShieldGen",{radius:0.5,height:0.8}); }catch(_){}
      }
    }
    // Spectral invis on hit
    if(setId==="Spectral" && def.invisDur>0){
      const durMs=def.invisDur*50;
      applyEffectSafe(api,pid,"Invisible",durMs,1);
      try{ scheduleTimeout(()=>applyEffectSafe(api,pid,"Invisible",durMs,1),1); }catch(_){}
      try{ spawnAt(api,pos,"spectralInvis",{radius:0.6,height:1.2}); }catch(_){}
      if(def.speedBonus>0){
        applyEffectSafe(api,pid,"Speed",def.speedDur*50,1);
      }
      spectralInvis.set(keyOf(pid), globalTick+def.invisDur);
    }
    // Geo shield per hit
    if(setId==="Geo" && def.shield>0){
      shieldAdd(api,pid,def.shield, def.shieldCap||16);
      try{ spawnAt(api,pos,"geoShield",{radius:0.5,height:0.6}); }catch(_){}
      // seismic every N hits
      if(def.seismicEvery>0){
        const k=keyOf(pid);
        const cur=(geoHits.get(k)||0)+1;
        geoHits.set(k,cur);
        if(cur % def.seismicEvery===0){
          const seis=def.seismic;
          const nears=nearbyMobs(api,pos,seis.radius);
          for(const {id, pos:mp} of nears){
            try{ damageMob(api,id,seis.damage,pid); }catch(_){}
            if(seis.push) try{ const dx=mp[0]-pos[0], dz=mp[2]-pos[2]; const d=Math.sqrt(dx*dx+dz*dz)||1; const vx=(dx/d)*seis.push, vz=(dz/d)*seis.push; if(typeof api.applyImpulse==="function") api.applyImpulse(id,vx,0.2,vz); }catch(_){}
          }
          try{ spawnZone(api,pos,"geoSeismic",seis.radius,0.3); }catch(_){}
        }
      }
    }
    // Voltplate discharge on being hit
    if(setId==="Voltplate" && def.dischargeChance>0){
      if(Math.random() < def.dischargeChance && !onCooldown(voltDischargeCd,pid,10)){
        setCooldown(voltDischargeCd,pid);
        const dmg=def.dischargeDmg||5;
        const radius=def.dischargeRadius||2.5;
        const targets=def.dischargeTargets||1;
        const nears=nearbyMobs(api,pos,radius);
        let hit=0;
        for(const {id,pos:mp} of nears){
          if(hit>=targets) break;
          try{ damageMob(api,id,dmg,pid); hit++; }catch(_){}
          if(def.slow) applyEffectSafe(api,id,"Slowness",def.slow.duration||40, def.slow.level||1);
          try{ spawnAt(api,mp,"voltplateDischarge",{radius:0.5,height:0.8}); }catch(_){}
        }
        try{ spawnAt(api,pos,"voltplateDischarge",{radius:0.6,height:1.0}); }catch(_){}
        // charges for level5
        if(def.charges){
          const cur=voltCharges.get(keyOf(pid))||0;
          const next=Math.min(def.charges.max, cur+def.charges.perDischarge);
          voltCharges.set(keyOf(pid),next);
          if(def.chainUltimate && next>=def.charges.max){
            // chain ultimate
            const ult=def.chainUltimate;
            const nears2=nearbyMobs(api,pos,ult.radius);
            let uh=0;
            for(const {id,pos:mp} of nears2){ if(uh>=ult.hits) break; try{ damageMob(api,id,ult.damage,pid); uh++; }catch(_){}
              try{ spawnAt(api,mp,"voltplateUltimate",{radius:0.5,height:0.8}); }catch(_){}
              // chain particles connecting
              try{ spawnAt(api,[(pos[0]+mp[0])/2,(pos[1]+mp[1])/2,(pos[2]+mp[2])/2],"voltplateChain",{radius:0.3,height:0.4}); }catch(_){}
            }
            try{ spawnZone(api,pos,"voltplateUltimate",ult.radius,0.6); }catch(_){}
            if(ult.consume) voltCharges.set(keyOf(pid),0);
            flyingMsg(api,pid,[{str:"Chain Lightning!",style:{color:"#00E5FF"}}],"Damage");
          }
        }
      }
    }
    // Astral slow is passive tick, not on damaged (but we can note)
  }
  // Apply curse/poison debuff to incoming damage: if attacker is poisoned/cursed by this player, reduce its damage? Actually poisoned enemies deal less damage (Serpentite L4) and cursed deal less (Cursemetal L3)
  // But we already handle incoming damage from attacker: attacker is the mob hitting player, if that mob is cursed/poisoned by player, we reduce damage
  if(attackerMobId){
    const mid=String(attackerMobId);
    const c=cursedMobs.get(mid);
    if(c && c.dmgDealtMult && c.dmgDealtMult<1){
      modifiedDamage = Math.max(1, Math.round(modifiedDamage * c.dmgDealtMult));
    }
    const pois=serpentPoisons.get(mid);
    if(pois && pois.debuff>0){
      modifiedDamage = Math.max(1, Math.round(modifiedDamage * (1-pois.debuff)));
    }
  }
  return modifiedDamage;
}

// onDealingDamage (player deals damage)
export function onDealingDamage(api, playerId, mobId, damage){
  const pid=playerId;
  const counts=getArmorCounts(api,pid);
  let modified=damage;
  const pos=posOf(api,mobId, playerPos(api,pid));
  for(const [setId,cnt] of counts){
    const lvl=armorLevelForCount(cnt); const def=getLevelDef(setId,lvl); if(!def) continue;
    // Sanguine lifesteal
    if(setId==="Sanguine" && Number.isFinite(damage) && def.lifesteal>0){
      const heal=Math.max(1, Math.round(damage * def.lifesteal));
      // excess to shield
      let actualHeal=heal;
      if(def.excessToShield>0){
        try{
          const cur=typeof api.getHealth==="function"?api.getHealth(pid):null;
          const max=typeof api.getMaxHealth==="function"?api.getMaxHealth(pid):null;
          if(Number.isFinite(cur)&&Number.isFinite(max) && cur+heal>max){
            const excess=(cur+heal)-max;
            const toShield=Math.round(excess*def.excessToShield);
            if(toShield>0) shieldAdd(api,pid,toShield,20);
            actualHeal=heal; // still heal to max, shield extra already
          }
        }catch(_){}
      }
      healPlayer(api,pid,actualHeal);
      try{ if(pos) spawnAt(api,pos,"sanguineDrainMob",{radius:0.4,height:0.6}); }catch(_){}
      try{ const pp=playerPos(api,pid); if(pp) spawnAt(api,pp,"sanguineHealPlayer",{radius:0.5,height:0.8}); }catch(_){}
    }
    // Kingly Amethite ability damage mult
    if(setId==="Kingly Amethite" && Number.isFinite(modified) && def.abilityDmgMult>1){
      // Check if this is an ability damage (we consider any weapon elemental extra as ability). For now treat any hit with level5 explosion ready? Simpler: increase all damage by abilityDmgMult for weapon ability hits.
      // We'll track consecutive uses
      const st=kinglyAmethiteState.get(keyOf(pid)) || {uses:0,lastUseTick:-9999,buffUntil:0,buffMult:1,aoeBonus:0,explosionReady:false, explosionCount:0};
      // consecutive bonus
      let mult=def.abilityDmgMult;
      if(st.buffUntil>globalTick && st.buffMult>1) mult *= st.buffMult;
      modified = Math.max(1, Math.round(modified * mult));
      // update uses
      const now=globalTick;
      if(now - st.lastUseTick <= (def.consecutiveWindow||160)){
        st.uses+=1;
      } else {
        st.uses=1;
      }
      st.lastUseTick=now;
      if(def.consecutiveBonus>0 && st.uses >= (def.consecutiveNeed||3)){
        st.buffUntil = now + (def.consecutiveBuffDur||100);
        st.buffMult = 1 + def.consecutiveBonus;
        try{ const pp=playerPos(api,pid); if(pp) spawnAt(api,pp,"kinglyAmethiteAccum",{radius:0.6,height:1.2}); }catch(_){}
      }
      if(def.explosionAfter>0){
        st.explosionCount = (st.explosionCount||0)+1;
        if(st.explosionCount >= def.explosionAfter){
          st.explosionReady=true;
        }
      }
      st.aoeBonus=def.aoeBonus||0;
      kinglyAmethiteState.set(keyOf(pid),st);
      // if explosion ready, trigger
      if(st.explosionReady && def.explosion){
        const ex=def.explosion;
        if(pos){
          const nears=nearbyMobs(api,pos, ex.radius + (def.aoeBonus||0));
          for(const {id} of nears){ try{ damageMob(api,id,ex.damage,pid); }catch(_){}
          }
          try{ spawnZone(api,pos,"kinglyAmethiteExplosion",ex.radius,0.6); }catch(_){}
        }
        st.explosionReady=false; st.explosionCount=0;
        kinglyAmethiteState.set(keyOf(pid),st);
      }
    }
    // Astral slowed extra damage
    if(setId==="Astral" && mobId){
      const isSlowed = false; // we track via aura? For now if mob in astralGlowingArmor or slowed via tick, we can check a set
      // We'll check if mob is in our slowed set (we can maintain slowedMobs map via tick)
      // Simpler: if we have aura active, extra damage
      // We'll implement via global auraSlowed map
      if(def.slowDmgMult>0 && isMobSlowedByAstral(pid,mobId)){
        modified = Math.max(1, Math.round(modified * (1+def.slowDmgMult)));
      }
    }
    // Nova damage per charge
    if(setId==="Nova" && Number.isFinite(modified) && def.dmgPerCharge>0){
      const charges=novaChargesArmor.get(keyOf(pid))||0;
      if(charges>0){
        modified = Math.max(1, Math.round(modified * (1 + charges*def.dmgPerCharge)));
      }
    }
    // Cursemetal cursed take more damage
    if(setId==="Cursemetal" && mobId){
      const c=cursedMobs.get(String(mobId));
      if(c && c.dmgTakenMult>1){
        modified = Math.max(1, Math.round(modified * c.dmgTakenMult));
      }
    }
  }
  // Kingly Diamond shield break handled in onDamaged not here
  return modified;
}

// Track slowed for Astral
const astralSlowed=new Map(); // mobId -> expireTick
function isMobSlowedByAstral(pid,mid){
  const entry=astralSlowed.get(String(mid));
  if(!entry) return false;
  if(entry.expireTick<globalTick) { astralSlowed.delete(String(mid)); return false; }
  return entry.owner===keyOf(pid);
}

// onMobKilled
export function onMobKilled(api, playerId, mobId){
  const pid=playerId;
  const counts=getArmorCounts(api,pid);
  const mobP=posOf(api,mobId, playerPos(api,pid));
  const pPos=playerPos(api,pid);
  const center=mobP||pPos;
  // Prevent infinite recursion: if this kill was already from armor explosion chain, limit depth 1
  const killKey=String(mobId)+"|"+keyOf(pid)+"|"+globalTick;
  if(globalThis.__armorKillDepth && globalThis.__armorKillDepth.has(killKey)) return;
  if(!globalThis.__armorKillDepth) globalThis.__armorKillDepth=new Set();
  globalThis.__armorKillDepth.add(killKey);
  // Clean old depth after 5 ticks
  if(globalThis.__armorKillDepth.size>100){
    const arr=[...globalThis.__armorKillDepth];
    for(let i=0;i<arr.length-80;i++) globalThis.__armorKillDepth.delete(arr[i]);
  }

  for(const [setId,cnt] of counts){
    const lvl=armorLevelForCount(cnt); const def=getLevelDef(setId,lvl); if(!def) continue;
    // Rubellite
    if(setId==="Rubellite"){
      if(def.healOnKill>0) healPlayer(api,pid,def.healOnKill);
      if(def.regenMs>0){
        let entry=rubelliteStacks.get(keyOf(pid));
        if(!entry) entry={level:0,lastKillTick:-9999,maxLevel:def.maxLevel||1,regenEndTick:0};
        // update maxLevel to current def's maxLevel
        entry.maxLevel=def.maxLevel||1;
        const now=globalTick;
        const windows=def.windowTicks||[200,180,160];
        const elapsed=now-entry.lastKillTick;
        let needWindow=Infinity;
        if(entry.level>=1 && entry.level<=3) needWindow=windows[entry.level-1]||160;
        let newLevel=1;
        if(entry.level===0) newLevel=1;
        else if(elapsed <= needWindow) newLevel=Math.min(entry.maxLevel, entry.level+1);
        else newLevel=1;
        entry.level=newLevel; entry.lastKillTick=now; entry.regenEndTick=now + Math.ceil(def.regenMs/50);
        rubelliteStacks.set(keyOf(pid),entry);
        applyEffectSafe(api,pid,"Health Regen",def.regenMs, newLevel);
        if(pPos) try{ spawnZone(api,pPos,"rubelliteKillZone",2.0,0.6); }catch(_){}
        // excess to shield at max level
        if(def.excessToShield>0 && newLevel>=entry.maxLevel){
          // if health already full, excess heal converted? We'll just add shield 2
          try{ shieldAdd(api,pid,2,20); }catch(_){}
          try{ if(pPos) spawnAt(api,pPos,"rubelliteMaxAura",{radius:0.7,height:0.8}); }catch(_){}
        }
      } else if(def.healOnKill>0){
        try{ spawnAt(api, pPos||mobP, "rubelliteRegen",{radius:0.5,height:0.8}); }catch(_){}
      }
    }
    // Magmasteel explosion if burned mob died
    if(setId==="Magmasteel" && def.explosion && center){
      const burned=magBurns.has(String(mobId));
      if(burned){
        const ex=def.explosion;
        const nears=nearbyMobs(api,center, ex.radius);
        for(const {id,pos:mp} of nears){
          if(String(id)===String(mobId)) continue;
          try{ damageMob(api,id,ex.damage,pid); }catch(_){}
          if(ex.spreadBurn){
            // spread burn with reduced dur
            magBurns.set(String(id),{owner:pid,dmg:def.burnDmg||2,ticksLeft:60,interval:20,nextTick:globalTick+20,pos:mp?[...mp]:null,mobId:String(id)});
            try{ spawnAt(api,mp,"magmaBurn",{radius:0.4,height:0.8}); }catch(_){}
          }
        }
        try{ spawnZone(api,center,"magmaExplosion",ex.radius,0.6); }catch(_){}
        magBurns.delete(String(mobId));
      }
    }
    // Serpentite spread
    if(setId==="Serpentite" && def.spreadRadius && center){
      if(serpentPoisons.has(String(mobId))){
        const nears=nearbyMobs(api,center,def.spreadRadius);
        let spread=0;
        for(const {id,pos:mp} of nears){
          if(String(id)===String(mobId)) continue;
          if(spread>= (def.spreadCount||2)) break;
          serpentPoisons.set(String(id),{owner:pid,dmg:def.poisonDmg||1,ticksLeft:def.poisonDur||80,interval:def.poisonInterval||20,nextTick:globalTick+20,pos:mp?[...mp]:null,mobId:String(id),debuff:def.debuff||0});
          try{ spawnAt(api,mp,"serpentSpread",{radius:0.4,height:0.6}); }catch(_){}
          spread++;
        }
        try{ spawnZone(api,center,"serpentSpread",def.spreadRadius,0.4); }catch(_){}
        serpentPoisons.delete(String(mobId));
      }
    }
    // Cursemetal spread + explosion
    if(setId==="Cursemetal" && cursedMobs.has(String(mobId)) && center){
      const cm=cursedMobs.get(String(mobId));
      if(def.spread>0){
        const nears=nearbyMobs(api,center,def.spreadRadius||5);
        for(const {id,pos:mp} of nears){
          if(String(id)===String(mobId)) continue;
          cursedMobs.set(String(id),{owner:pid,expireTick:globalTick+200,dmgTakenMult:def.dmgTakenMult||1.2,dmgDealtMult:def.dmgDealtMult||0.85});
          try{ spawnAt(api,mp,"curseSpread",{radius:0.5,height:0.8}); }catch(_){}
          break; // only 1
        }
      }
      if(def.explosion){
        const ex=def.explosion;
        const nears=nearbyMobs(api,center,ex.radius);
        for(const {id} of nears){
          if(String(id)===String(mobId)) continue;
          try{ damageMob(api,id,ex.damage,pid); }catch(_){}
        }
        try{ spawnZone(api,center,"curseExplosion",ex.radius,0.6); }catch(_){}
      }
      cursedMobs.delete(String(mobId));
    }
    // Sanguine wave/heal
    if(setId==="Sanguine"){
      if(def.killWaveHeal>0 && pPos){
        healPlayer(api,pid,def.killWaveHeal);
        try{ spawnZone(api,pPos,"sanguineWave",3,0.4); }catch(_){}
        try{ spawnAt(api,pPos,"sanguineHealPlayer",{radius:0.5,height:0.8}); }catch(_){}
      }
      if(def.killExplosion && center){
        const ex=def.killExplosion;
        const nears=nearbyMobs(api,center,ex.radius);
        for(const {id} of nears){ try{ damageMob(api,id,ex.damage,pid); }catch(_){}
        }
        healPlayer(api,pid,ex.heal||3);
        try{ spawnZone(api,center,"sanguineExplosion",ex.radius,0.6); }catch(_){}
      }
    }
    // Spectral attract + explosion
    if(setId==="Spectral" && def.attract && center){
      const nears=nearbyMobs(api,center,def.attract.radius);
      for(const {id,pos:mp} of nears){
        if(String(id)===String(mobId)) continue;
        const dx=center[0]-mp[0], dy=(center[1]+0.5)-mp[1], dz=center[2]-mp[2]; const dist=Math.sqrt(dx*dx+dy*dy+dz*dz)||1; const str=def.attract.strength||1;
        const vx=(dx/dist)*str, vy=(dy/dist)*str+0.2, vz=(dz/dist)*str;
        try{ if(typeof api.applyImpulse==="function") api.applyImpulse(id,vx,vy,vz); else if(typeof api.setVelocity==="function") api.setVelocity(id,vx,vy,vz); }catch(_){}
        try{ spawnAt(api,mp,"spectralSpiral",{radius:0.4,height:0.6}); }catch(_){}
      }
      try{ spawnZone(api,center,"spectralSpiral",def.attract.radius,0.4); }catch(_){}
      if(def.explosion){
        const ex=def.explosion;
        // delay explosion
        const delay=ex.delay||10;
        try{ scheduleTimeout(()=>{
          const nears2=nearbyMobs(api,center,ex.radius);
          for(const {id} of nears2){ try{ damageMob(api,id,ex.damage,pid); }catch(_){}
          }
          try{ spawnZone(api,center,"spectralExplosion",ex.radius,0.6); }catch(_){}
        },delay); }catch(_){
          const nears2=nearbyMobs(api,center,ex.radius);
          for(const {id} of nears2){ try{ damageMob(api,id,ex.damage,pid); }catch(_){}
          }
        }
      }
    }
    // Geo mines
    if(setId==="Geo" && def.mines && center){
      const mDef=def.mines;
      const nears=nearbyMobs(api,center,6);
      const targets=nears.length?nears:[{id:null,pos:center}];
      for(const {id,pos:mp} of targets){
        const p=mp||center;
        for(let i=0;i<(mDef.count||2);i++){
          const offset=[(Math.random()-0.5)*2,0,(Math.random()-0.5)*2];
          const minePos=[p[0]+offset[0], p[1], p[2]+offset[2]];
          geoMines.push({pos:[...minePos],owner:pid,explodeTick:globalTick+mDef.delay, dmg:mDef.damage, radius:mDef.radius, chain:mDef.chain||false, chainRadius:mDef.chainRadius||3, anchorId:id?String(id):null});
          try{ spawnAt(api,minePos,"geoMineTick",{radius:0.5,height:0.4}); }catch(_){}
        }
        break;
      }
    }
    // Astral glowing
    if(setId==="Astral" && def.glowing && center){
      const nears=nearbyMobs(api,center,def.glowing.radius);
      for(const {id,pos:mp} of nears){
        if(String(id)===String(mobId)) continue;
        applyEffectSafe(api,id,"Glowing",def.glowing.duration*50,1);
        astralGlowingArmor.set(String(id),{owner:keyOf(pid),expireTick:globalTick+def.glowing.duration,extraMult:def.glowing.extraDmg||0.15});
        try{ spawnAt(api,mp,"astralGlowing",{radius:0.5,height:0.8}); }catch(_){}
      }
      try{ spawnZone(api,center,"astralGlowing",2.5,0.6); }catch(_){}
    }
    // Voltplate handled in discharge, not kill (but could add extra? keep as is)
    // Nova charges
    if(setId==="Nova"){
      const cur=novaChargesArmor.get(keyOf(pid))||0;
      const next=Math.min(def.maxCharges||10, cur+ (def.chargePerKill||1));
      novaChargesArmor.set(keyOf(pid),next);
      try{ flyingMsg(api,pid,[{str:`Nova ${next}/${def.maxCharges}`,style:{color:"#FFFFFF"}}],"Damage"); }catch(_){}
      try{ const pp=pPos||mobP; if(pp) spawnAt(api,pp,"novaOrbit",{radius:0.6,height:1.0}); }catch(_){}
      if(def.small && next>=def.smallAt && next< (def.majorAt||999)){
        // small explosion
        const ex=def.small;
        const nears=nearbyMobs(api,pPos||mobP, ex.radius);
        for(const {id} of nears){ try{ damageMob(api,id,ex.damage,pid); }catch(_){}
        }
        try{ spawnZone(api,pPos||mobP,"novaSmall",ex.radius,0.6); }catch(_){}
      }
      if(def.major && next>=def.majorAt){
        const ex=def.major;
        const centr=pPos||mobP;
        const nears=nearbyMobs(api,centr,ex.radius);
        for(const {id} of nears){ try{ damageMob(api,id,ex.damage,pid); }catch(_){}
        }
        try{ spawnZone(api,centr,"novaMajor",ex.radius,0.8); }catch(_){}
        if(ex.consume) novaChargesArmor.set(keyOf(pid),0);
      }
    }
  }
  // cleanup DOT for this mob
  magBurns.delete(String(mobId));
  serpentPoisons.delete(String(mobId));
  astralGlowingArmor.delete(String(mobId));
  cursedMobs.delete(String(mobId));
}

// Tick handler
export function tick(api){
  globalTick++;
  const now=globalTick;
  // DOT magBurns
  if(magBurns.size){
    for(const [mid,entry] of [...magBurns.entries()]){
      if(now>=entry.nextTick){
        try{ damageMob(api,entry.mobId||mid,entry.dmg,entry.owner); }catch(_){}
        try{ const cur=posOf(api,entry.mobId,null); const p=cur||entry.pos; if(p) spawnAt(api,p,"magmaBurn",{radius:0.4,height:0.8}); if(cur) entry.pos=[...cur]; }catch(_){}
        entry.nextTick=now+entry.interval;
      }
      entry.ticksLeft--;
      if(entry.ticksLeft<=0) magBurns.delete(mid);
    }
  }
  if(serpentPoisons.size){
    for(const [mid,entry] of [...serpentPoisons.entries()]){
      if(now>=entry.nextTick){
        try{ damageMob(api,entry.mobId||mid,entry.dmg,entry.owner); }catch(_){}
        try{ const cur=posOf(api,entry.mobId,null); const p=cur||entry.pos; if(p) spawnAt(api,p,"serpentPoison",{radius:0.4,height:0.6}); if(cur) entry.pos=[...cur]; }catch(_){}
        entry.nextTick=now+entry.interval;
      }
      entry.ticksLeft--;
      if(entry.ticksLeft<=0) serpentPoisons.delete(mid);
    }
  }
  // cursed expiry
  if(cursedMobs.size){
    for(const [mid,e] of [...cursedMobs.entries()]) if(now>=e.expireTick) cursedMobs.delete(mid);
  }
  if(astralGlowingArmor.size){
    for(const [mid,e] of [...astralGlowingArmor.entries()]) if(now>=e.expireTick) astralGlowingArmor.delete(mid);
  }
  // Geo mines
  if(geoMines.length){
    for(let i=geoMines.length-1;i>=0;i--){
      const m=geoMines[i];
      if(now%10===0) try{ spawnAt(api,m.pos,"geoMineTick",{radius:0.4,height:0.4}); }catch(_){}
      if(now>=m.explodeTick){
        const nears=nearbyMobs(api,m.pos,m.radius);
        for(const {id,pos:mp} of nears){
          const dx=(mp?mp[0]:m.pos[0])-m.pos[0], dy=(mp?mp[1]:m.pos[1])-m.pos[1], dz=(mp?mp[2]:m.pos[2])-m.pos[2];
          if(dx*dx+dy*dy+dz*dz <= (m.radius+0.6)*(m.radius+0.6)){
            try{ damageMob(api,id,m.dmg,m.owner); }catch(_){}
            // chain trigger nearby mines
            if(m.chain){
              for(let j=geoMines.length-1;j>=0;j--){
                if(j===i) continue;
                const other=geoMines[j];
                const dx2=other.pos[0]-m.pos[0], dy2=other.pos[1]-m.pos[1], dz2=other.pos[2]-m.pos[2];
                if(dx2*dx2+dy2*dy2+dz2*dz2 <= (m.chainRadius*m.chainRadius)){
                  other.explodeTick=Math.min(other.explodeTick, now+5);
                }
              }
            }
          }
        }
        try{ spawnZone(api,m.pos,"geoMineExplosion",1.6,0.6); }catch(_){}
        geoMines.splice(i,1);
      }
    }
  }
  // Astral aura passive (every 20 ticks)
  if(now%20===0 && api){
    let pids=[]; try{ pids=typeof api.getPlayerIds==="function"?api.getPlayerIds():[]; }catch(_){}
    for(const pid of pids){
      const lvl=getArmorLevel(api,pid,"Astral");
      if(lvl<=0) continue;
      const def=getLevelDef("Astral",lvl); if(!def||!def.aura) continue;
      const pPos=playerPos(api,pid); if(!pPos) continue;
      const radius=def.aura.radius||6;
      const nears=nearbyMobs(api,pPos,radius);
      for(const {id,pos:mp} of nears){
        if(def.aura.dps) try{ damageMob(api,id,def.aura.dps,pid); }catch(_){}
        applyEffectSafe(api,id,"Slowness",def.aura.slowDur*50||1000,1);
        astralSlowed.set(String(id),{owner:keyOf(pid),expireTick:now+40});
        try{ spawnAt(api,mp,"astralAura",{radius:0.5,height:0.7}); }catch(_){}
      }
      // also slower aura for levels 1-3 without damage: apply slow only
      if(!def.aura.dps && def.slow){
        const slowRad=def.slowRadius||4;
        const nears2=nearbyMobs(api,pPos,slowRad);
        for(const {id,pos:mp} of nears2){
          applyEffectSafe(api,id,"Slowness",1000,1);
          astralSlowed.set(String(id),{owner:keyOf(pid),expireTick:now+30});
          try{ spawnAt(api,mp,"astralAura",{radius:0.4,height:0.6}); }catch(_){}
        }
      }
    }
  }
  // Nova orbiting particles
  if(now%20===0 && novaChargesArmor.size){
    for(const [k,cnt] of [...novaChargesArmor.entries()]){
      if(cnt<=0) continue;
      // find playerId from key (need reverse: we store key as pid string, need actual pid - keep as string id works for getPosition)
      const pid=k;
      const pos=playerPos(api,pid); if(!pos) continue;
      try{ spawnAt(api,[pos[0],pos[1]+1,pos[2]],"novaOrbit",{radius:0.7+cnt*0.1,height:1.0}); }catch(_){}
      if(cnt>=4) try{ spawnAt(api,pos,"novaBright",{radius:0.5,height:0.8}); }catch(_){}
    }
  }
  // Voltplate charge decay visual?
  // Rubellite regen already via effect, no tick needed
  // Spectral invis expiry handled via effect duration, but we track map for cleanup
  if(spectralInvis.size){
    for(const [k,exp] of [...spectralInvis.entries()]) if(now>=exp) spectralInvis.delete(k);
  }
  // Kingly Diamond low health check every 20 ticks
  if(now%20===0){
    let pids=[]; try{ pids=typeof api.getPlayerIds==="function"?api.getPlayerIds():[]; }catch(_){}
    for(const pid of pids){
      const lvl=getArmorLevel(api,pid,"Kingly Diamond"); if(lvl<5) continue;
      const def=getLevelDef("Kingly Diamond",5); if(!def.lowHealth) continue;
      const ratio=healthRatio(api,pid);
      if(ratio<=def.lowHealth.threshold && !onCooldown(kinglyDiamondLowCd,pid,def.lowHealth.cooldown)){
        setCooldown(kinglyDiamondLowCd,pid);
        shieldAdd(api,pid,def.lowHealth.shield,20);
        // defense bonus is via onDamaged already? But we need temporary defense buff: we can set a map for timed defense
        temporaryDefense.set(keyOf(pid),{mult:def.lowHealth.defenseBonus, expire:now+def.lowHealth.duration});
        try{ const pp=playerPos(api,pid); if(pp) spawnZone(api,pp,"kinglyDiamondUltimate",2.0,0.6); }catch(_){}
        applyEffectSafe(api,pid,"HealthShield",def.lowHealth.duration*50,1);
      }
    }
  }
  // clean temporary defense
  if(temporaryDefense.size){
    for(const [k,v] of [...temporaryDefense.entries()]) if(now>=v.expire) temporaryDefense.delete(k);
  }
  // clean slowed
  if(astralSlowed.size && now%40===0){
    for(const [mid,e] of [...astralSlowed.entries()]) if(now>=e.expireTick) astralSlowed.delete(mid);
  }
  // shield break detect for Kingly Diamond
  // We need to track shield before/after: simpler check each tick shield amount dropped to 0 after being >0
  if(now%5===0){
    let pids=[]; try{ pids=typeof api.getPlayerIds==="function"?api.getPlayerIds():[]; }catch(_){}
    for(const pid of pids){
      const lvl=getArmorLevel(api,pid,"Kingly Diamond"); if(lvl<4) continue;
      const def=getLevelDef("Kingly Diamond",Math.max(4,lvl));
      if(!def.shieldBreak) continue;
      const curShield=shieldGet(api,pid);
      const prev=prevShield.get(keyOf(pid)) ?? curShield;
      if(prev>0 && curShield<=0 && !onCooldown(shieldBreakCd,pid,60)){
        setCooldown(shieldBreakCd,pid);
        const pos=playerPos(api,pid); if(pos){
          const nears=nearbyMobs(api,pos,def.shieldBreak.radius);
          for(const {id,pos:mp} of nears){
            try{ damageMob(api,id,def.shieldBreak.damage,pid); }catch(_){}
            try{ const dx=mp[0]-pos[0], dz=mp[2]-pos[2]; const d=Math.sqrt(dx*dx+dz*dz)||1; const vx=(dx/d)*def.shieldBreak.push, vz=(dz/d)*def.shieldBreak.push; if(typeof api.applyImpulse==="function") api.applyImpulse(id,vx,0.3,vz); }catch(_){}
          }
          try{ spawnZone(api,pos,"kinglyDiamondBreak",def.shieldBreak.radius,0.4); }catch(_){}
        }
      }
      prevShield.set(keyOf(pid),curShield);
    }
  }
  // ── dynamic armor descriptions (refresh every 1s) ──
  if (now % 20 === 0){
    try { refreshAllArmorDescriptions(api); } catch(_){}
  }
}

// ── Dynamic armor descriptions ──
const ARMOR_PARTS = ["Helmet","Chestplate","Leggings","Boots","Gauntlets"];
const _descCache = new Map(); // "pid:setId" -> lvl
export function refreshArmorDescriptions(api, playerId){
  if (!api || !playerId || typeof api.setItemStat !== "function") return 0;
  const counts = getArmorCounts(api, playerId);
  let updated = 0;
  for (const setId of ARMOR_IDS){
    const cnt = counts.get(setId) || 0;
    const lvl = armorLevelForCount(cnt);
    const key = `${keyOf(playerId)}:${setId}`;
    if (_descCache.get(key) === lvl) continue;
    _descCache.set(key, lvl);
    let desc;
    try { desc = getArmorDescriptionForCount(setId, cnt); }
    catch(_){ const d=getLevelDef(setId, Math.max(1,lvl)); desc = d?.desc || ""; }
    for (const part of ARMOR_PARTS){
      const itemName = `${setId} ${part}`;
      try { api.setItemStat(playerId, itemName, "description", desc); updated++; } catch(_){}
    }
  }
  return updated;
}
export function refreshAllArmorDescriptions(api){
  if (!api || typeof api.getPlayerIds !== "function") return 0;
  let total=0;
  try {
    const pids = api.getPlayerIds() || [];
    for (const pid of pids) total += refreshArmorDescriptions(api, pid) || 0;
  } catch(_){}
  return total;
}
export function _getDescCache(){ return _descCache; }
export function _clearDescCache(){ _descCache.clear(); }

const temporaryDefense=new Map(); // pid -> {mult,expire}
const prevShield=new Map();

export function getTemporaryDefense(pid){
  const e=temporaryDefense.get(keyOf(pid));
  if(!e) return 0;
  if(e.expire<globalTick){ temporaryDefense.delete(keyOf(pid)); return 0; }
  return e.mult||0;
}

export function forgetPlayer(playerId){
  const k=keyOf(playerId);
  rubelliteStacks.delete(k); amethiteCooldown.delete(k); geoHits.delete(k); voltCharges.delete(k); voltDischargeCd.delete(k); novaChargesArmor.delete(k); spectralInvis.delete(k); spectralSpeed.delete(k); kinglyAmethiteState.delete(k); kinglyDiamondLowCd.delete(k); shieldBreakCd.delete(k); temporaryDefense.delete(k); prevShield.delete(k);
  for (const sid of ARMOR_IDS) _descCache.delete(`${k}:${sid}`);
  // clean mines owned by player
  for(let i=geoMines.length-1;i>=0;i--) if(String(geoMines[i].owner)===k) geoMines.splice(i,1);
  // clean dot owned
  for(const [mid,e] of [...magBurns.entries()]) if(String(e.owner)===k) magBurns.delete(mid);
  for(const [mid,e] of [...serpentPoisons.entries()]) if(String(e.owner)===k) serpentPoisons.delete(mid);
  for(const [mid,e] of [...cursedMobs.entries()]) if(String(e.owner)===k) cursedMobs.delete(mid);
}
export function _reset(){
  globalTick=0;
  magBurns.clear(); serpentPoisons.clear(); cursedMobs.clear(); rubelliteStacks.clear(); amethiteCooldown.clear(); geoHits.clear(); geoMines.length=0; astralGlowingArmor.clear(); astralSlowed.clear(); voltCharges.clear(); voltDischargeCd.clear(); novaChargesArmor.clear(); spectralInvis.clear(); spectralSpeed.clear(); kinglyAmethiteState.clear(); kinglyDiamondLowCd.clear(); shieldBreakCd.clear(); temporaryDefense.clear(); prevShield.clear(); _descCache.clear();
  if(globalThis.__armorKillDepth) globalThis.__armorKillDepth.clear();
}
export function _getMagBurns(){ return magBurns; }
export function _getSerpentPoisons(){ return serpentPoisons; }
export function _getCursedMobs(){ return cursedMobs; }
export function _getRubelliteStacks(){ return rubelliteStacks; }
export function _getGeoMines(){ return geoMines; }
export function _getNovaCharges(){ return novaChargesArmor; }
export function _getVoltCharges(){ return voltCharges; }
