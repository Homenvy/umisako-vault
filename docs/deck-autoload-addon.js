// deck-autoload-addon.js
// Adds status banner, deck autoload + file-picker fallback, and keyboard shortcuts.
(function(){
  const $ = (s)=> document.querySelector(s);
  function ensureStatus(){
    let el = $("#status");
    if (!el) {
      const header = document.querySelector("header") || document.body;
      el = document.createElement("div");
      el.id = "status";
      el.style.cssText = "margin-top:6px;color:#f6c177;font-size:0.95rem;";
      el.textContent = "Ready.";
      header.appendChild(el);
    }
    return el;
  }
  function setStatus(msg, bad=false){
    const s = ensureStatus();
    s.textContent = msg;
    s.style.color = bad ? "#ff6b6b" : "#f6c177";
    const eb = $("#errorBox");
    if (bad && eb) { eb.textContent = msg; eb.style.color = "#ff6b6b"; }
  }

  async function tryFetch(url){
    try{
      const res = await fetch(url);
      if(!res.ok) throw new Error("HTTP "+res.status);
      return await res.text();
    }catch(e){
      console.warn("Fetch failed", url, e);
      return null;
    }
  }

  async function autoLoad(){
    setStatus("Probing for deck...");
    const candidates = (window.DECK_PATHS_OVERRIDE && Array.isArray(window.DECK_PATHS_OVERRIDE))
      ? window.DECK_PATHS_OVERRIDE
      : ["../assets/cards.json","../../assets/cards.json","./assets/cards.json","assets/cards.json","/projects/mtg-simulator/assets/cards.json"];
    for(const p of candidates){
      const txt = await tryFetch(p);
      if (txt){
        try {
          if (typeof window.loadDeckFromText === "function"){
            window.loadDeckFromText(txt, 0);
            setStatus(`Auto-loaded deck from ${p}`);
            return true;
          }
        } catch(e){
          console.error("loadDeckFromText failed", e);
          setStatus("Deck parse error for "+p, true);
          return false;
        }
      }
    }
    setStatus("Auto-load failed. Pick a JSON deck instead.", true);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async (e)=>{
      const f = input.files && input.files[0];
      if (!f){ setStatus("No file selected.", true); return; }
      const txt = await f.text();
      try{
        window.loadDeckFromText(txt, 0);
        setStatus(`Loaded local deck: ${f.name}`);
      }catch(err){
        console.error(err);
        setStatus("Failed to parse local deck.", true);
      }
    }, { once:true });
    input.click();
    return false;
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", (e)=>{
    if (e.target && (/input|textarea|select/i).test(e.target.tagName)) return;
    const key = e.key.toLowerCase();
    if (key === "n" && typeof window.advancePhase === "function"){ window.advancePhase(); }
    if (key === "e" && typeof window.endTurn === "function"){ window.endTurn(); }
    if (key === "d" && typeof window.drawCards === "function"){
      const ap = (window.state && window.state.activePlayer) || 0;
      window.drawCards(ap, 1);
    }
  });

  window.addEventListener("DOMContentLoaded", ()=>{
    ensureStatus();
    if (!window.DISABLE_AUTOLOAD){
      autoLoad();
    } else {
      setStatus("Autoload disabled. Use existing controls.");
    }
  });
})();