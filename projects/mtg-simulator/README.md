# MTG Deck Simulator - Mechanics Reference

This simulator replicates gameplay interactions for Magic: The Gathering decks, 
with a custom Final Fantasy-themed card set. All mechanics are interpreted strictly 
according to MTG rules where possible.

---

## Core Keywords

### Haste
A creature with Haste can attack or use abilities with the **{T}** symbol the turn it enters the battlefield.  
Without Haste, creatures have **Summoning Sickness** until your next turn.

### Trample
When attacking, if lethal damage is assigned to a blocker, any excess damage is dealt to the defending player or planeswalker.

### Vigilance
A creature with Vigilance does **not tap** when attacking.

### Flying
This creature can only be blocked by creatures with **Flying** or **Reach**.

### Reach
This creature can block creatures with **Flying**, even if it does not have Flying itself.

### Ward {X}
Whenever a permanent with Ward becomes the target of a spell or ability an opponent controls, 
that opponent must pay an additional cost of **{X}**, or the spell/ability is countered.

### Lifelink
When a creature with Lifelink deals damage, its controller gains that much life.

---

## Saga Mechanics
**Sagas** are a special subtype of Enchantment that gain a *Lore Counter* during their controller's upkeep.  
Each chapter ability (I, II, III, etc.) resolves in order as Lore Counters are added.

- When the final chapter resolves, the Saga is sacrificed unless it has a **Transform** or **Adventure** effect that changes its state.

---

## Transform
Transform cards have two faces:
- **Front Face:** The card's initial state when cast or played.
- **Back Face:** The alternate state after a Transform condition is met.

Rules:
- When a card transforms, it **exiles itself**, then returns to the battlefield transformed.
- It retains any counters it had unless explicitly stated otherwise.

---

## Adventure
Certain cards can be cast as either a **Creature** or a **Sorcery/Instant**.  
- When cast as a spell, the card is **exiled** after resolution and may later be cast as its creature side.
- Example application: Ishgard and Zanarkand.

---

## Custom Mechanics

### Landfall
**Landfall** triggers whenever a land enters the battlefield under your control.  
The effect depends on the specific card, such as buffs, token generation, or card draws.

### Tiered
A **custom mechanic unique to this set**.  
Certain cards have escalating effects depending on additional mana paid.

Example:
- **Cross Slash (Base):** Destroy target tapped creature.
- **Blade Beam (+{1}):** Destroy multiple tapped creatures with different controllers.
- **Omnislash (+{3}{W}):** Destroy all tapped creatures.

Rules:
- Player may **choose which tier** to activate while casting.
- Only **one tier** effect resolves per cast.

---

## TODOs
- [ ] Implement a Deck List Viewer for easier browsing of JSON card data.
- [ ] Expand rule engine for multiplayer support.
- [ ] Add detailed documentation for complex targeting effects.
