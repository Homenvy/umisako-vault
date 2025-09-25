/* =======================
 * MTG Turn Engine (engine.js) — Full Working Build
 * ======================= */

// ----- Constants & State -----
const TurnOrder = ['UNTAP','UPKEEP','DRAW','MAIN1','BEGIN_COMBAT','DECLARE_ATTACKERS','DECLARE_BLOCKERS','COMBAT_DAMAGE','END_COMBAT','MAIN2','END_STEP','CLEANUP'];
const AutoPhases = new Set(['UNTAP','UPKEEP','DRAW']); // auto-advance these

const state = {
  players: [
    { id:0, life:40, library:[], hand:[], battlefield:[], graveyard:[], exile:[], commandZone:[], commanderCasts:0, cmdDamageReceived:{1:0}, deckName:'P1 Deck', mana:{W:0,U:0,B:0,R:0,G:0,C:0}, landPlaysRemaining:1, mulliganAvailable:true, mulligans:0, turnsTaken:1 },
    { id:1, life:40, library:[], hand:[], battlefield:[], graveyard:[], exile:[], commandZone:[], commanderCasts:0, cmdDamageReceived:{0:0}, deckName:'P2 Deck', mana:{W:0,U:0,B:0,R:0,G:0,C:0}, landPlaysRemaining:1, mulliganAvailable:true, mulligans:0, turnsTaken:0 }
  ],
  activePlayer: 0,
  turnNumber: 1,
  phaseIndex: 0,
  firstTurnDrawSkippedForP0: false,
  stack: [],
  attackers: [],
  blockers: {},
  loser: null
};

// Which player's info you are allowed to see (radio P1/P2)
window.viewerSeat = 0;

// ----- Helpers -----
const $  = (sel)=> document.querySelector(sel);
const $$ = (sel)=> Array.from(document.querySelectorAll(sel));
function textHas(hay, ...needles){ const s=(hay||'').toLowerCase(); return needles.some(n=> s.includes(String(n).toLowerCase())); }
const COLORS = ['W','U','B','R','G'];

function manaString(m){ return `W${m.W} U${m.U} B${m.B} R${m.R} G${m.G} C${m.C}`; }
function addMana(pid, sym){ const p=state.players[pid]; if (p.mana[sym]!=null) p.mana[sym]++; else p.mana.C++; updateKPIs(); }
function resetManaAtCleanup(){ for(const pl of state.players){ pl.mana={W:0,U:0,B:0,R:0,G:0,C:0}; } updateKPIs(); }

// Parse mana cost like "{2}{G}{G}{W}"
function parseCost(str){
  const out = { generic:0, colors:{W:0,U:0,B:0,R:0,G:0}, valid:true };
  if (!str) return out;
  const re = /\{([^}]+)\}/g; let m;
  while((m=re.exec(str))){
    const tok=m[1];
    if (/^\d+$/.test(tok)) out.generic += parseInt(tok,10);
    else if (COLORS.includes(tok)) out.colors[tok]++;
    else if (tok==='C') out.generic += 1; // treat {C} as generic for affordability
    else out.valid=false;
  }
  return out;
}
function canAfford(cost, pool){
  if (!cost) return true;
  const need = {generic:cost.generic, ...cost.colors};
  for (const c of COLORS){ if (pool[c] < need[c]) return false; }
  let availableGeneric = pool.C;
  for (const c of COLORS){ availableGeneric += (pool[c] - need[c]); }
  return availableGeneric >= need.generic;
}
function payCost(cost, pool){
  for(const c of COLORS){ pool[c] -= cost.colors[c]; }
  let g = cost.generic;
  const useC = Math.min(g, pool.C); pool.C -= useC; g -= useC;
  for (const c of COLORS){ if (g<=0) break; const use = Math.min(g, pool[c]); pool[c]-=use; g-=use; }
}

function commanderDisplayCost(pid){
  const p = state.players[pid];
  if (!p.commandZone.length) return '—';
  const base = p.commandZone[0].mana_cost || '—';
  const tax  = 2*(p.commanderCasts||0);
  return tax>0 ? `${base} + {${tax}}` : base;
}

// ----- Logging -----
function logAll(msg){ console.log(msg); }
function logP(pid,msg){ console.log(`P${pid+1}: `+msg); }

// ----- Deck IO -----
function coerceDeckShape(parsed){
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.cards)) return parsed.cards;
  if (parsed && typeof parsed==='object') return [parsed];
  return null;
}
function expandQuantities(cards){ const out=[]; for(const c of cards){ const q=Math.max(1, c.quantity||1); for(let i=0;i<q;i++){ out.push(structuredClone(c)); } } return out; }
function smartParseDeck(text){
  const obj = JSON.parse(text);
  const arr = coerceDeckShape(obj);
  if (!arr) throw new Error('Deck JSON must be an array or { cards:[...] }');
  const flat = expandQuantities(arr);
  const commanderName = (obj && obj.commander) ? obj.commander : (arr.find(c => Array.isArray(c.tags) && c.tags.includes('commander'))?.name);
  const deckName = obj && (obj.deck_name || obj.name || obj.title) || null;
  return { flat, commanderName, deckName };
}
async function loadDeckFromFile(input, playerIdx){ const f=input.files?.[0]; if(!f) return; const text=await f.text(); loadDeckFromText(text, playerIdx); }
function loadDeckFromText(text, playerIdx){
  try{
    const eb=$('#errorBox'); if(eb) {eb.textContent=''; eb.style.color='#6fd1ff';}
    const {flat, commanderName, deckName} = smartParseDeck(text);
    const p = state.players[playerIdx];
    p.library = flat.slice(); p.deckName = deckName || p.deckName || (playerIdx===0?'Eidolon':'Opp Deck');
    assignCommander(playerIdx, commanderName);
    renderAll(); logAll(`Loaded deck for P${playerIdx+1} (${flat.length} cards)${commanderName?` – Commander: ${commanderName}`:''}.`);
  }catch(e){ const eb=$('#errorBox'); if(eb) {eb.textContent = e.message; eb.style.color='#ff6f6f';} }
}
function loadDeckFromTextarea(textarea, playerIdx){ loadDeckFromText(textarea.value, playerIdx); }
function assignCommander(playerIdx, name){ if (!name) return; const p=state.players[playerIdx]; const ix=p.library.findIndex(c=>c.name===name); if(ix>=0){ const card=p.library.splice(ix,1)[0]; p.commandZone=[card]; } }

function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } }
function drawCards(player, n){
  for(let i=0;i<n;i++){
    if (player.library.length===0){ state.loser=player.id; alert(`P${player.id+1} loses: draw from empty library.`); return; }
    const card=player.library.pop(); player.hand.push(card);
    logP(player.id, `You draw: ${card.name}`); logP(1-player.id, 'Opponent draws a card.');
  }
  renderPCZ();
}

// ----- Permanents & keywords -----
const KEYWORDS = ['flying','trample','lifelink','haste','first strike','double strike','vigilance','reach'];
function parseKeywords(text){ const s=(text||'').toLowerCase(); const set=new Set(); for(const k of KEYWORDS){ if (s.includes(k)) set.add(k); } return set; }
function parsePT(pt, which){ if (!pt) return null; const m=/^\s*(\d+|\*)\/(\d+|\*)\s*$/.exec(pt.trim()); if(!m) return null; return which==='p' ? (m[1]==='*'?0:+m[1]) : (m[2]==='*'?0:+m[2]); }
function makePermanent(card, ownerId){
  const kw=new Set([...(card.types||[]).map(t=>t.toLowerCase()), ...parseKeywords(card.effects)]);
  return { uid: (crypto.randomUUID?crypto.randomUUID():('id'+Math.random())), owner:ownerId, name:card.name||'(Unnamed)', base:card, types:(card.types||[]).slice(),
    power:parsePT(card.power_toughness,'p'), toughness:parsePT(card.power_toughness,'t'),
    tapped:false, summoningSick:true, counters:{ plus1:0, lore:0 }, keywords:kw,
    isCreature:(card.types||[]).includes('Creature'), isSaga:(card.types||[]).includes('Saga') };
}

// ----- Lands: ETB and tapping -----
function enterTappedByText(card){ return textHas(card.effects,'enters the battlefield tapped','enters tapped'); }
function landEntersTapped(card, pid){
  let tapped = enterTappedByText(card);
  const name=(card.name||'').toLowerCase();
  // "Town" special: untapped for first 3 turns of its controller
  if (name.includes('town')){
    const p=state.players[pid];
    if ((p.turnsTaken||0) <= 3) tapped=false;
  }
  return tapped;
}
function landHasAnyColorAbility(card){
  const eff=(card.effects||'').toLowerCase();
  return eff.includes('any color') || (card.name||'').toLowerCase().includes('town');
}
function landTapSelfDamage(card){
  const eff=(card.effects||'').toLowerCase();
  return /deal[s]?\s*1\s*damage\s*to\s*you|take[s]?\s*1\s*damage/.test(eff);
}

// ----- Effects popover -----
const eff = {
  el:null, title:null, text:null,
  show(evt, name, effects){
    if(!this.el){ this.el=$('#effectsPopover'); this.title=$('#effTitle'); this.text=$('#effText'); }
    if(!this.el) return;
    this.title.textContent = name||'Card Effects';
    this.text.textContent  = effects||'(No rules text)';
    this.el.style.display='block';
    const pad=10; let x=evt.clientX+pad, y=evt.clientY+pad; const r=this.el.getBoundingClientRect();
    if (x+r.width>window.innerWidth) x = evt.clientX - r.width - pad;
    if (y+r.height>window.innerHeight) y = evt.clientY - r.height - pad;
    this.el.style.left = x+'px'; this.el.style.top = y+'px';
  },
  hide(){ if(this.el) this.el.style.display='none'; }
};
document.addEventListener('pointerdown', (e)=>{
  if (!e.target.closest('.pcz-eff') && e.target.id!=='pczCmdEff'){ eff.hide(); }
});

// ----- Battlefield (override to show non-lands top & lands bottom) -----
function renderBattlefields(){
  const center = $('#centerPanel');
  if (!center) return;

  // Build 4 sections once
  if (!$('#bfTopP0')){
    const wrap = document.createElement('div');
    wrap.className = 'stack';
    wrap.style.marginTop='8px';
    wrap.innerHTML =
      '<div class="list"><div class="row" style="justify-content:space-between"><strong>P1 — Battlefield (Non-lands)</strong><span class="muted small" id="bfTopCountP0">0</span></div><ul id="bfTopP0"></ul></div>' +
      '<div class="list"><div class="row" style="justify-content:space-between"><strong>P1 — Lands</strong><span class="muted small" id="bfLandCountP0">0</span></div><ul id="bfLandP0"></ul></div>' +
      '<div class="list"><div class="row" style="justify-content:space-between"><strong>P2 — Battlefield (Non-lands)</strong><span class="muted small" id="bfTopCountP1">0</span></div><ul id="bfTopP1"></ul></div>' +
      '<div class="list"><div class="row" style="justify-content:space-between"><strong>P2 — Lands</strong><span class="muted small" id="bfLandCountP1">0</span></div><ul id="bfLandP1"></ul></div>';
    // Remove old bfP0/bfP1 containers if present
    center.querySelectorAll('#bfP0,#bfP1').forEach(el=>el.parentElement?.remove());
    center.appendChild(wrap);
  }

  const zones = { top:[ $('#bfTopP0'), $('#bfTopP1') ], land:[ $('#bfLandP0'), $('#bfLandP1') ] };
  zones.top.forEach(z=> z.innerHTML=''); zones.land.forEach(z=> z.innerHTML='');

  const counts = { top:[0,0], land:[0,0] };

  [0,1].forEach(pid=>{
    state.players[pid].battlefield.forEach(perm=>{
      const isLand = (perm.types||[]).includes('Land');
      const target = isLand ? zones.land[pid] : zones.top[pid];

      const li=document.createElement('li');
      const kwArr = perm.keywords ? Array.from(perm.keywords) : [];
      const kw = kwArr.map(k=>`<span class="kw">${k}</span>`).join(' ');
      const counters=[]; if (perm.counters?.plus1) counters.push(`<span class="counter">+1/+1×${perm.counters.plus1}</span>`); if (perm.counters?.lore) counters.push(`<span class="counter">Lore×${perm.counters.lore}</span>`);
      const pt=(perm.power!=null&&perm.toughness!=null)?`<span class="tag">${perm.power+(perm.counters?.plus1||0)}/${perm.toughness+(perm.counters?.plus1||0)}</span>`:'';
      const taps=perm.tapped?' (tapped)':'';

      li.innerHTML = `<div class="cardline"><strong>${perm.name}</strong> ${pt} ${kw} ${counters.join(' ')} <button class="btn ghost pcz-eff">Effects</button> <span class="muted small">${taps}</span></div>`;

      // Tap / Untap
      const tapBtn=document.createElement('button'); tapBtn.className='btn ghost'; tapBtn.textContent=perm.tapped?'Untap':'Tap';
      tapBtn.addEventListener('click', ()=>{
        if (!perm.tapped){
          const base=perm.base||{}; const name=(base.name||'').toLowerCase(); let produced=false;
          if (name.includes('forest')) { addMana(perm.owner,'G'); produced=true; }
          else if (name.includes('island')) { addMana(perm.owner,'U'); produced=true; }
          else if (name.includes('swamp')) { addMana(perm.owner,'B'); produced=true; }
          else if (name.includes('mountain')) { addMana(perm.owner,'R'); produced=true; }
          else if (name.includes('plains')) { addMana(perm.owner,'W'); produced=true; }
          // explicit symbols
          const rx=/\{([WUBRGC])\}/g; let m, saw=false; while((m=rx.exec(base.effects||''))){ addMana(perm.owner, m[1]); produced=true; saw=true; }
          // any-color fallback to {C}
          if (!saw && landHasAnyColorAbility(base)) { addMana(perm.owner,'C'); produced=true; }
          if (produced && landTapSelfDamage(base)){ state.players[perm.owner].life--; logAll(`P${perm.owner+1} takes 1 from ${perm.name}.`); }
        }
        perm.tapped=!perm.tapped; renderBattlefields(); updateKPIs();
      });
      li.appendChild(tapBtn);

      // Any-color quick buttons
      if (perm.base && landHasAnyColorAbility(perm.base)){
        const grp=document.createElement('span'); grp.style.marginLeft='6px';
        ['W','U','B','R','G'].forEach(sym=>{
          const b=document.createElement('button'); b.className='btn ghost'; b.textContent=sym;
          b.addEventListener('click',()=>{
            if (perm.tapped) return;
            addMana(perm.owner, sym);
            perm.tapped=true;
            if (landTapSelfDamage(perm.base)){ state.players[perm.owner].life--; logAll(`P${perm.owner+1} takes 1 from ${perm.name}.`); }
            renderBattlefields(); updateKPIs();
          });
          grp.appendChild(b);
        });
        li.appendChild(grp);
      }

      // Transform
      if (perm.base && perm.base.transform){
        const bT=document.createElement('button'); bT.className='btn secondary'; bT.textContent='Transform';
        bT.addEventListener('click', ()=> doTransform(perm));
        li.appendChild(bT);
      }

      // Effects
      const effBtn = li.querySelector('.pcz-eff');
      effBtn.addEventListener('pointerdown', (evt)=> eff.show(evt, perm.name, perm.base?.effects||'(No rules text)'));
      effBtn.addEventListener('pointerup', ()=> eff.hide());

      target.appendChild(li);
      counts[isLand?'land':'top'][pid]++;
    });
  });

  const cTop0=$('#bfTopCountP0'); if(cTop0) cTop0.textContent=counts.top[0];
  const cTop1=$('#bfTopCountP1'); if(cTop1) cTop1.textContent=counts.top[1];
  const cLand0=$('#bfLandCountP0'); if(cLand0) cLand0.textContent=counts.land[0];
  const cLand1=$('#bfLandCountP1'); if(cLand1) cLand1.textContent=counts.land[1];
}

// ----- Casting & transform -----
function playFromHand(pid, idx){
  const player=state.players[pid]; const card=player.hand.splice(idx,1)[0];
  if ((card.types||[]).includes('Land')){
    if (player.landPlaysRemaining<=0){ logP(pid,'You have already played a land this turn.'); player.hand.splice(idx,0,card); renderPCZ(); return; }
    const perm=makePermanent(card, pid); perm.tapped = landEntersTapped(card, pid);
    player.battlefield.push(perm); player.landPlaysRemaining--; logAll(`P${pid+1} plays land ${card.name}${perm.tapped?' (tapped)':''}.`);
  } else if ((card.types||[]).includes('Instant') || (card.types||[]).includes('Sorcery')){
    const cost=parseCost(card.mana_cost||''); if (!canAfford(cost, player.mana)){ logP(pid,`Not enough mana to cast ${card.name}.`); player.hand.splice(idx,0,card); renderPCZ(); return; }
    payCost(cost, player.mana); logAll(`P${pid+1} casts ${card.name} → graveyard.`); player.graveyard.push(card);
  } else {
    const cost=parseCost(card.mana_cost||''); if (!canAfford(cost, player.mana)){ logP(pid,`Not enough mana to cast ${card.name}.`); player.hand.splice(idx,0,card); renderPCZ(); return; }
    payCost(cost, player.mana); const perm=makePermanent(card, pid); player.battlefield.push(perm); logAll(`P${pid+1} casts ${card.name} onto the battlefield.`);
  }
  renderAll();
}
function toTransformFace(base){ if (!base.transform) return null; const face = Array.isArray(base.transform) ? base.transform[0] : base.transform; const obj=structuredClone(face); if(!obj.types) obj.types=[]; return obj; }
function doTransform(perm){
  const face=toTransformFace(perm.base); if(!face){ logAll(`${perm.name} has no transform face.`); return; }
  perm.base=face; perm.name=face.name||perm.name; perm.types=(face.types||[]).slice();
  perm.keywords=new Set([...(face.types||[]).map(t=>t.toLowerCase()), ...parseKeywords(face.effects)]);
  const p=parsePT(face.power_toughness,'p'), t=parsePT(face.power_toughness,'t'); if(p!=null) perm.power=p; if(t!=null) perm.toughness=t;
  logAll(`${perm.name} transforms.`); renderAll();
}

// ----- Sagas & Phases -----
function addLoreCounters(){ for(const pl of state.players){ for(const perm of pl.battlefield){ if(perm.isSaga){ perm.counters.lore=(perm.counters.lore||0)+1; logAll(`${perm.name}: Lore → ${perm.counters.lore}`); } } } renderBattlefields(); }
function eligibleAttackers(pid){ const p=state.players[pid]; return p.battlefield.filter(x=>x.isCreature && !x.tapped && (!x.summoningSick || x.keywords.has('haste'))); }
function computeDamageStep(attackingList, blockingMap, firstStrikeOnly){
  const defender = state.players[1 - state.activePlayer];
  let totalToPlayer=0, lifelinkGain=0, commanderToPlayer=0;
  for(const a of attackingList){
    const hasFS = a.keywords.has('first strike') || a.keywords.has('double strike');
    if (firstStrikeOnly && !hasFS) continue;
    if (!firstStrikeOnly && (a.keywords.has('first strike') && !a.keywords.has('double strike'))) continue;
    const blocked = (blockingMap[a.uid] && blockingMap[a.uid].length);
    if (!blocked){
      const power = a.power + (a.counters.plus1||0);
      totalToPlayer += power;
      if (a.keywords.has('lifelink')) lifelinkGain += power;
      const isCommander = state.players[a.owner].commandZone.length && state.players[a.owner].commandZone[0].name===a.name;
      if (isCommander) commanderToPlayer += power;
    } else if (a.keywords.has('trample')){
      const blockers = blockingMap[a.uid].map(id => findPermanentById(id)); let lethal=0;
      for(const b of blockers){ lethal += (b.toughness + (b.counters.plus1||0)); }
      const overflow = Math.max(0, (a.power + (a.counters.plus1||0)) - lethal);
      totalToPlayer += overflow; if (a.keywords.has('lifelink')) lifelinkGain += overflow;
    }
  }
  if (totalToPlayer>0){ defender.life -= totalToPlayer; logAll(`Defender (P${defender.id+1}) takes ${totalToPlayer}.`); }
  if (lifelinkGain>0){ const ap=state.players[state.activePlayer]; ap.life += lifelinkGain; logAll(`Attacker (P${ap.id+1}) gains ${lifelinkGain} (lifelink).`); }
  if (commanderToPlayer>0){ defender.cmdDamageReceived[state.activePlayer]=(defender.cmdDamageReceived[state.activePlayer]||0)+commanderToPlayer; logAll(`Commander damage to P${defender.id+1}: +${commanderToPlayer} (total ${defender.cmdDamageReceived[state.activePlayer]}).`); }
  updateKPIs();
}
function findPermanentById(uid){ for(const p of state.players){ const f=p.battlefield.find(x=>x.uid===uid); if (f) return f; } return null; }

function handleUntap(){
  const ap=state.players[state.activePlayer];
  const skip = ap.battlefield.some(perm=> textHas(perm.base?.effects,'skip your untap step'));
  if (skip){ logAll(`P${ap.id+1} skips their untap step.`); return; }
  ap.battlefield.forEach(p=>{ const selfStops = textHas(p.base?.effects,"doesn't untap",'does not untap'); if (!selfStops) p.tapped=false; });
  logAll(`P${ap.id+1} untaps.`);
}
function handleUpkeep(){ /* upkeep checks placeholder */ }
function handleDraw(){
  const isP0First=(state.turnNumber===1&&state.activePlayer===0);
  if(isP0First && !state.firstTurnDrawSkippedForP0){
    state.firstTurnDrawSkippedForP0=true; state.players[0].mulliganAvailable=false; renderPCZ();
    logP(0,'You skip your very first draw.'); logP(1,'Opponent skips their very first draw.'); return;
  }
  const ap=state.players[state.activePlayer];
  const skip = ap.battlefield.some(perm=> textHas(perm.base?.effects,'skip your draw step'));
  if (skip){ ap.mulliganAvailable=false; renderPCZ(); logP(ap.id,'You skip your draw step.'); logP(1-ap.id,'Opponent skips their draw step.'); return; }
  drawCards(ap,1); ap.mulliganAvailable=false; renderPCZ();
}
function handleMain1(){ addLoreCounters(); state.players[state.activePlayer].battlefield.forEach(p=>p.summoningSick=false); state.players[state.activePlayer].landPlaysRemaining=1; }
function handleBeginCombat(){ state.attackers=[]; state.blockers={}; logAll('Begin combat.'); }
function handleDeclareAttackers(){ const ap=state.activePlayer; const list=eligibleAttackers(ap); list.forEach(a=>{ if(!a.keywords.has('vigilance')) a.tapped=true; a.summoningSick=false; }); state.attackers=list; logAll(`Attackers: ${list.map(x=>x.name).join(', ')||'none'}`); renderBattlefields(); }
function handleDeclareBlockers(){ logAll('No blockers auto-assigned.'); }
function handleCombatDamage(){ computeDamageStep(state.attackers, state.blockers, true); computeDamageStep(state.attackers, state.blockers, false); }
function handleEndStep(){ logAll('End step.'); }
function handleCleanup(){ logAll('Cleanup.'); resetManaAtCleanup(); endOfTurnRotate(); }

function endOfTurnRotate(){
  state.phaseIndex=0;
  if (state.activePlayer===1) state.turnNumber+=1;
  state.activePlayer = 1 - state.activePlayer;
  try { state.players[state.activePlayer].turnsTaken = (state.players[state.activePlayer].turnsTaken||0)+1; } catch(e){}
  try { state.players[state.activePlayer].landPlaysRemaining = 1; } catch(e){}
  updateKPIs();
}
function runPhase(ph){
  switch(ph){
    case 'UNTAP': handleUntap(); break;
    case 'UPKEEP': handleUpkeep(); break;
    case 'DRAW': handleDraw(); break;
    case 'MAIN1': handleMain1(); break;
    case 'BEGIN_COMBAT': handleBeginCombat(); break;
    case 'DECLARE_ATTACKERS': handleDeclareAttackers(); break;
    case 'DECLARE_BLOCKERS': handleDeclareBlockers(); break;
    case 'COMBAT_DAMAGE': handleCombatDamage(); break;
    case 'END_COMBAT': logAll('End combat.'); break;
    case 'MAIN2': logAll('Main 2.'); break;
    case 'END_STEP': handleEndStep(); break;
    case 'CLEANUP': handleCleanup(); break;
  }
}
function nextPhase(){
  const ph = TurnOrder[state.phaseIndex];
  runPhase(ph);
  state.phaseIndex = (state.phaseIndex+1)%TurnOrder.length;

  // Auto-run simple phases in sequence (UNTAP→UPKEEP→DRAW)
  let safety=0;
  while (AutoPhases.has(TurnOrder[(state.phaseIndex-1+TurnOrder.length)%TurnOrder.length]) && safety++<3){
    const autoph = TurnOrder[state.phaseIndex];
    runPhase(autoph);
    state.phaseIndex=(state.phaseIndex+1)%TurnOrder.length;
  }
  updateKPIs();
}

// ----- Commander -----
function castCommander(pid){
  const p=state.players[pid];
  if(!p.commandZone.length){ logP(pid, 'You have no commander set.'); logP(1-pid, 'Opponent has no commander set.'); return; }
  const cmd=p.commandZone[0];
  const baseCost=parseCost(cmd.mana_cost||'');
  const tax=2*(p.commanderCasts||0);
  const totalCost={ generic: baseCost.generic + tax, colors:{...baseCost.colors} };
  if (!canAfford(totalCost, p.mana)){ logP(pid, `Not enough mana to cast ${cmd.name} (needs ${commanderDisplayCost(pid)}).`); return; }
  payCost(totalCost, p.mana);
  const perm=makePermanent(cmd, pid); p.battlefield.push(perm); p.commanderCasts++;
  logAll(`P${pid+1} casts Commander ${cmd.name}. Commander tax is now +${2*(p.commanderCasts)} next time.`);
  renderAll();
}

// ----- PCZ Rendering (Hand & Commander & GY/Exile) -----
function renderPCZ(){
  const seat = window.viewerSeat||0, opp=1-seat;
  const p = state.players[seat], o=state.players[opp];

  // Info bar
  const life=$('#pczLife'), mana=$('#pczMana'), oLib=$('#pczOppLib'), oHand=$('#pczOppHand');
  if (life) life.textContent = p.life;
  if (mana) mana.textContent = manaString(p.mana);
  if (oLib) oLib.textContent = o.library.length;
  if (oHand) oHand.textContent = o.hand.length;

  // Hand list
  const handWrap = $('#pczHandList');
  if (handWrap){
    handWrap.innerHTML='';
    if (p.hand.length===0){
      const empty=document.createElement('div'); empty.className='pcz-empty muted'; empty.textContent='Your hand is empty.';
      handWrap.appendChild(empty);
    } else {
      p.hand.forEach((c, idx)=>{
        const isLand=(c.types||[]).includes('Land');
        const cost=parseCost(c.mana_cost||'');
        const canPlaySpell = !isLand && canAfford(cost, p.mana);
        const canPlayLand  = isLand && p.landPlaysRemaining>0;
        const card=document.createElement('div');
        card.className='pcz-card';
        card.innerHTML = `<div class="pcz-card-name"><strong>${c.name}</strong></div>
                          <div class="pcz-card-meta">${c.mana_cost?`<span class="tag">${c.mana_cost}</span>`:''} <span class="tag">${(c.types||[]).join('/')}</span></div>
                          <div class="pcz-actions"><button class="btn good pcz-play" ${!(canPlaySpell||canPlayLand)?'disabled':''}>${isLand?'Play Land':'Play'}</button> <button class="btn ghost pcz-eff">Effects</button></div>`;
        card.querySelector('.pcz-play').addEventListener('click', ()=> playFromHand(seat, idx));
        const ebtn = card.querySelector('.pcz-eff');
        ebtn.addEventListener('pointerdown',(evt)=> eff.show(evt, c.name, c.effects||'(No rules text)'));
        ebtn.addEventListener('pointerup',()=> eff.hide());
        handWrap.appendChild(card);
      });
    }
  }

  // Commander section
  const cmdName=$('#pczCmdName'), cmdCost=$('#pczCmdCost'), cmdTax=$('#pczCmdTax'), btnCast=$('#pczCastCmd'), btnEff=$('#pczCmdEff');
  if (cmdName) cmdName.textContent = `Commander: ${p.commandZone.length?p.commandZone[0].name:'—'}`;
  if (cmdCost) cmdCost.textContent = commanderDisplayCost(seat);
  if (cmdTax)  cmdTax.textContent  = `+${2*(p.commanderCasts||0)}`;
  if (btnCast){
    let disabled=true;
    if (p.commandZone.length){
      const base=parseCost(p.commandZone[0].mana_cost||''); const tax=2*(p.commanderCasts||0);
      const total={generic: base.generic+tax, colors:{...base.colors}};
      disabled = !canAfford(total, p.mana);
    }
    btnCast.disabled = disabled;
  }
  if (btnEff){
    btnEff.onpointerdown = (evt)=> eff.show(evt, p.commandZone[0]?.name||'Commander', p.commandZone[0]?.effects||'(No rules text)');
    btnEff.onpointerup   = ()=> eff.hide();
  }

  // Graveyard & Exile lists (always keep current)
  const gyBox = $('#pczGYList');
  if (gyBox){
    gyBox.innerHTML='';
    if (!p.graveyard.length) gyBox.innerHTML='<em class="muted">Empty</em>';
    else {
      p.graveyard.slice().reverse().forEach(c=>{
        const div=document.createElement('div'); div.className='pcz-card';
        const cost = c.mana_cost? `<span class="tag">${c.mana_cost}</span>` : '';
        const types = `<span class="tag">${(c.types||[]).join('/')}</span>`;
        div.innerHTML = `<strong>${c.name}</strong> ${cost} ${types} <button class="btn ghost pcz-eff">Effects</button>`;
        const effBtn=div.querySelector('.pcz-eff');
        effBtn.addEventListener('pointerdown',(evt)=> eff.show(evt, c.name, c.effects||'(No rules text)'));
        effBtn.addEventListener('pointerup',()=> eff.hide());
        gyBox.appendChild(div);
      });
    }
  }
  const exBox = $('#pczExileList');
  if (exBox){
    exBox.innerHTML='';
    if (!p.exile.length) exBox.innerHTML='<em class="muted">Empty</em>';
    else {
      p.exile.slice().reverse().forEach(c=>{
        const div=document.createElement('div'); div.className='pcz-card';
        const cost = c.mana_cost? `<span class="tag">${c.mana_cost}</span>` : '';
        const types = `<span class="tag">${(c.types||[]).join('/')}</span>`;
        div.innerHTML = `<strong>${c.name}</strong> ${cost} ${types} <button class="btn ghost pcz-eff">Effects</button>`;
        const effBtn=div.querySelector('.pcz-eff');
        effBtn.addEventListener('pointerdown',(evt)=> eff.show(evt, c.name, c.effects||'(No rules text)'));
        effBtn.addEventListener('pointerup',()=> eff.hide());
        exBox.appendChild(div);
      });
    }
  }
}

// ----- KPIs & full render -----
function updateKPIs(){
  const ap=$('#activePlayer'), tn=$('#turnNumber'), ph=$('#phaseName');
  if (ap) ap.textContent = state.activePlayer===0?'P1':'P2';
  if (tn) tn.textContent = state.turnNumber;
  if (ph) ph.textContent = TurnOrder[state.phaseIndex];
  renderPCZ();
}
function renderAll(){ renderBattlefields(); renderPCZ(); }

// ----- Wire up -----
function wireUp(){
  // Top controls
  $('#btnNext')?.addEventListener('click', nextPhase);
  $('#btnEndTurn')?.addEventListener('click', ()=>{ endOfTurnRotate(); logAll('End turn.'); });
  $('#btnMulligan')?.addEventListener('click', ()=>{
    const seat=window.viewerSeat||0; const p=state.players[seat];
    if (!p.mulliganAvailable){ logP(seat,'Mulligan no longer available.'); return; }
    p.library = p.library.concat(p.hand.splice(0)); shuffle(p.library); drawCards(p,7); p.mulligans++; logAll(`P${seat+1} mulligans (x${p.mulligans}).`);
  });
  $('#btnNew')?.addEventListener('click', ()=>{ resetGame(); renderAll(); logAll('New game.'); });
  $('#btnTest')?.addEventListener('click', ()=>{
    try{
      // Tiny sanity checks
      if (!Array.isArray(state.players) || state.players.length!==2) throw new Error('Players not initialized');
      if (!TurnOrder.includes('DRAW')) throw new Error('Turn order missing DRAW');
      const eb=$('#errorBox'); if(eb){ eb.textContent='Self‑Test: PASS'; eb.style.color='#6fffa5'; }
    }catch(err){
      const eb=$('#errorBox'); if(eb){ eb.textContent='Self‑Test: FAIL — '+err.message; eb.style.color='#ff6f6f'; }
    }
  });

  // PCZ footer controls
  $('#pczDraw')?.addEventListener('click', ()=>{ const seat=window.viewerSeat||0; drawCards(state.players[seat],1); });
  $('#pczNextPhase')?.addEventListener('click', ()=> nextPhase());
  $('#pczEndTurn')?.addEventListener('click', ()=>{ endOfTurnRotate(); logAll('End turn.'); });

  // Life buttons
  $('#lifeMinus')?.addEventListener('click', ()=>{ const seat=window.viewerSeat||0; state.players[seat].life--; updateKPIs(); });
  $('#lifePlus')?.addEventListener('click',  ()=>{ const seat=window.viewerSeat||0; state.players[seat].life++; updateKPIs(); });

  // Deck IO buttons
  $('#btnLoadP0')?.addEventListener('click', async ()=>{ const file=$('#fileP0').files?.[0]; if(file){ const text=await file.text(); loadDeckFromText(text,0); } else { loadDeckFromTextarea($('#textP0'),0); } });
  $('#btnLoadP1')?.addEventListener('click', async ()=>{ const file=$('#fileP1').files?.[0]; if(file){ const text=await file.text(); loadDeckFromText(text,1); } else { loadDeckFromTextarea($('#textP1'),1); } });
  $('#fileP0')?.addEventListener('change', (e)=> loadDeckFromFile(e.target,0));
  $('#fileP1')?.addEventListener('change', (e)=> loadDeckFromFile(e.target,1));
  $('#btnShuffleP0')?.addEventListener('click', ()=>{ shuffle(state.players[0].library); renderPCZ(); logAll('P1 shuffles.'); });
  $('#btnShuffleP1')?.addEventListener('click', ()=>{ shuffle(state.players[1].library); renderPCZ(); logAll('P2 shuffles.'); });
  $('#btnDraw7P0')?.addEventListener('click', ()=> drawCards(state.players[0],7));
  $('#btnDraw7P1')?.addEventListener('click', ()=> drawCards(state.players[1],7));
  $('#btnDraw1P0')?.addEventListener('click', ()=> drawCards(state.players[0],1));
  $('#btnDraw1P1')?.addEventListener('click', ()=> drawCards(state.players[1],1));

  // Seat radios (viewer seat)
  $('#seatP0')?.addEventListener('change', (e)=>{ if(e.target.checked){ window.viewerSeat=0; renderAll(); } });
  $('#seatP1')?.addEventListener('change', (e)=>{ if(e.target.checked){ window.viewerSeat=1; renderAll(); } });

  // Commander cast from PCZ
  $('#pczCastCmd')?.addEventListener('click', ()=>{ const seat=window.viewerSeat||0; castCommander(seat); });
}

function resetGame(){
  state.players.forEach(pl=>{
    pl.life=40; pl.hand=[]; pl.battlefield=[]; pl.graveyard=[]; pl.exile=[];
    pl.commandZone=pl.commandZone.slice(0,1); pl.commanderCasts=0;
    pl.cmdDamageReceived={ [1-pl.id]:0 };
    pl.mana={W:0,U:0,B:0,R:0,G:0,C:0};
    pl.landPlaysRemaining=1; pl.mulliganAvailable=true; pl.mulligans=0;
    pl.turnsTaken = (pl.id===0?1:0);
  });
  state.activePlayer=0; state.turnNumber=1; state.phaseIndex=0;
  state.firstTurnDrawSkippedForP0=false; state.stack=[]; state.attackers=[]; state.blockers={};
  renderAll();
}

// ----- Init -----
(function init(){
  wireUp();
  renderAll();
  // bubble runtime errors into errorBox
  window.addEventListener('error', (e)=>{ const box=$('#errorBox'); if(box){ box.textContent='Runtime error: '+(e.error?.message||e.message); box.style.color='#ff6f6f'; } });
})();

// Expose functions for external usage (if needed)
window.renderPCZ = renderPCZ;
window.renderBattlefields = renderBattlefields;

/* ===== Mobile Thumb Dock Wiring ===== */
(function initMobileDock(){
  const isCoarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
  const isNarrow = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
  if (!(isCoarse && isNarrow)) return;

  document.body.classList.add('mobile');

  const dock = document.getElementById('pczDock');
  const core = document.getElementById('pczDockCore');
  const wheel = document.getElementById('pczWheel');
  const items = wheel ? Array.from(wheel.querySelectorAll('.pcz-item')) : [];
  const sheet = document.getElementById('pczSheet');
  const sheetTitle = document.getElementById('pczSheetTitle');
  const sheetContent = document.getElementById('pczSheetContent');
  const sheetClose = document.getElementById('pczSheetClose');

  if (!dock || !core || !wheel || !sheet || !sheetContent) return;

  let wheelIndex = 0; // 0..3 (Hand, Cmdr, GY, Exile)
  const zones = ['hand','commander','graveyard','exile'];

  function selectIndex(i){
    wheelIndex = ((i % zones.length) + zones.length) % zones.length;
    items.forEach(btn => btn.setAttribute('aria-selected', String(btn.dataset.zone === zones[wheelIndex])));
  }

  function rotate(delta){
    selectIndex(wheelIndex + delta);
    // Optional visual rotation (kept subtle): wheel.style.transform = `rotate(${wheelIndex * -10}deg)`;
  }

  function openSheetFor(zone){
    sheetTitle.textContent = zoneLabel(zone);
    // Clear and re-inject the right list using your existing render data.
    // We’ll reuse your renderer by routing zone DOM into the sheet.
    sheetContent.innerHTML = '';
    const frag = document.createDocumentFragment();

    if (zone === 'hand') {
      // render hand cards (reuse data/state)
      const seat = window.viewerSeat || 0;
      const p = state.players[seat];
      if (!p.hand.length) {
        const d = document.createElement('div');
        d.className = 'pcz-empty muted';
        d.textContent = 'Your hand is empty.';
        frag.appendChild(d);
      } else {
        p.hand.forEach((c, idx)=>{
          const isLand = (c.types||[]).includes('Land');
          const cost = parseCost(c.mana_cost||'');
          const canPlaySpell = !isLand && canAfford(cost, p.mana);
          const canPlayLand  = isLand && p.landPlaysRemaining>0;
          const card = document.createElement('div');
          card.className = 'pcz-card';
          card.innerHTML = `
            <div class="name">${c.name}</div>
            <div class="meta">${c.mana_cost?`${c.mana_cost}`:''} ${(c.types||[]).join('/')}</div>
          `;
          const row = document.createElement('div');
          row.className = 'row';
          const bPlay = document.createElement('button');
          bPlay.className = 'btn ' + (isLand ? (canPlayLand?'good':'ghost') : (canPlaySpell?'good':'ghost'));
          bPlay.textContent = isLand ? 'Play Land' : 'Play';
          bPlay.addEventListener('click', ()=> playFromHand(seat, idx));
          const bEff = document.createElement('button');
          bEff.className = 'btn ghost pcz-eff';
          bEff.textContent = 'Effects';
          bEff.addEventListener('pointerdown', (evt)=> eff.show(evt, c.name, c.effects||'(No rules text)'));
          bEff.addEventListener('pointerup', ()=> eff.hide());
          row.appendChild(bPlay); row.appendChild(bEff);
          card.appendChild(row);
          frag.appendChild(card);
        });
      }
    } else if (zone === 'commander') {
      const seat = window.viewerSeat || 0;
      const p = state.players[seat];
      const wrap = document.createElement('div');
      const cmdCost = commanderDisplayCost(seat);
      wrap.innerHTML = `
        <div class="kpi">
          <div class="card"><div class="label">Commander</div>
          <div class="value">${(p.commandZone[0]?.name)||'—'}</div></div>
          <div class="card"><div class="label">Cost + Tax</div>
          <div class="value">${cmdCost} · +${2*(p.commanderCasts||0)}</div></div>
        </div>
      `;
      const bCast = document.createElement('button');
      bCast.className = 'btn good';
      bCast.textContent = 'Cast Commander';
      bCast.addEventListener('click', ()=> castCommander(seat));
      wrap.appendChild(bCast);
      frag.appendChild(wrap);
    } else if (zone === 'graveyard' || zone === 'exile') {
      const seat = window.viewerSeat || 0;
      const p = state.players[seat];
      const list = (zone === 'graveyard') ? p.graveyard : p.exile;
      if (!list.length){
        const d=document.createElement('div');
        d.className='pcz-empty muted';
        d.textContent = zone==='graveyard' ? '(Empty Graveyard)' : '(Empty Exile)';
        frag.appendChild(d);
      } else {
        const ul=document.createElement('ul');
        list.forEach(c=>{
          const li=document.createElement('li');
          li.textContent = `${c.name} ${(c.types||[]).join('/')}`;
          ul.appendChild(li);
        });
        frag.appendChild(ul);
      }
    }
    sheetContent.appendChild(frag);
    sheet.setAttribute('aria-hidden','false');
  }

  function closeSheet(){ sheet.setAttribute('aria-hidden','true'); }

  function zoneLabel(z){
    return z === 'hand' ? 'Hand' :
           z === 'commander' ? 'Commander' :
           z === 'graveyard' ? 'Graveyard' :
           z === 'exile' ? 'Exiled' : z;
  }

  // Events
  core.addEventListener('click', ()=>{
    // Toggle sheet for currently selected zone
    const hidden = sheet.getAttribute('aria-hidden') !== 'false';
    if (hidden) openSheetFor(zones[wheelIndex]);
    else closeSheet();
  });
  sheetClose.addEventListener('click', closeSheet);

  items.forEach((btn, idx)=>{
    btn.addEventListener('click', ()=>{
      selectIndex(idx);
      openSheetFor(zones[wheelIndex]);
    });
  });

  // Basic wheel rotate (swipe/scroll)
  let touchStartX=0, touchStartY=0;
  wheel.addEventListener('touchstart', (e)=>{
    const t=e.changedTouches[0]; touchStartX=t.clientX; touchStartY=t.clientY;
  }, {passive:true});
  wheel.addEventListener('touchmove', (e)=>{
    const t=e.changedTouches[0];
    const dx=t.clientX-touchStartX, dy=t.clientY-touchStartY;
    // If movement is more horizontal toward left/up, rotate forward; down/right rotate back
    if (Math.abs(dx)+Math.abs(dy) > 30){
      const forward = (dx<0 || dy<0) ? 1 : -1;
      rotate(forward);
      touchStartX=t.clientX; touchStartY=t.clientY;
    }
  }, {passive:true});

  wheel.addEventListener('wheel', (e)=>{
    rotate(e.deltaY>0 ? 1 : -1);
    e.preventDefault();
  }, {passive:false});

  // Initial selection
  selectIndex(0);
})();
