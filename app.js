// Recipe Remix — frontend logic (vanilla JS, no framework).
//
// The browser never sees the API key. Every call goes to our own
// serverless function at /api/ask, which talks to Gemini.

// ---------- tiny state ----------
const state = {
  ingredients: [], // what the user has
  preference: "",
  recipes: [], // last recipes the agent produced
};

// ---------- element refs ----------
const $ = (id) => document.getElementById(id);
const chipInput = $("chip-input");
const ingredientInput = $("ingredient-input");
const preferenceInput = $("preference");
const generateBtn = $("generate-btn");
const resultsEl = $("results");
const statusEl = $("agent-status");
const statusText = $("agent-status-text");
const routeBadge = $("route-badge");
const askCard = $("ask-card");
const askInput = $("ask-input");
const askBtn = $("ask-btn");

// ---------- ingredient chips ----------
function addIngredient(value) {
  const v = value.trim().toLowerCase();
  if (!v || state.ingredients.includes(v)) return;
  state.ingredients.push(v);
  renderChips();
}

function removeIngredient(value) {
  state.ingredients = state.ingredients.filter((i) => i !== value);
  renderChips();
}

function renderChips() {
  // remove existing chips (keep the input box)
  chipInput.querySelectorAll(".chip").forEach((c) => c.remove());
  state.ingredients.forEach((ing) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${ing} <button aria-label="remove">×</button>`;
    chip.querySelector("button").onclick = () => removeIngredient(ing);
    chipInput.insertBefore(chip, ingredientInput);
  });
}

ingredientInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addIngredient(ingredientInput.value);
    ingredientInput.value = "";
  } else if (e.key === "Backspace" && !ingredientInput.value) {
    // backspace on empty input removes the last chip
    const last = state.ingredients[state.ingredients.length - 1];
    if (last) removeIngredient(last);
  }
});

document.querySelectorAll(".tag[data-add]").forEach((btn) => {
  btn.onclick = () => addIngredient(btn.dataset.add);
});

// ---------- talking to the agent ----------
async function callAgent(action, data, statusMessage) {
  showStatus(statusMessage);
  // dim + lock the current recipes so it's obvious the agent is reworking them
  if (state.recipes.length) resultsEl.classList.add("busy");
  try {
    const resp = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    const json = await resp.json();
    if (!resp.ok) throw new Error(json.error || "Request failed.");
    return json;
  } finally {
    hideStatus();
    resultsEl.classList.remove("busy");
  }
}

function showStatus(msg) {
  statusText.textContent = msg || "Remy is thinking…";
  statusEl.classList.remove("hidden");
}
function hideStatus() {
  statusEl.classList.add("hidden");
}

function showError(message) {
  resultsEl.innerHTML = `<div class="error">⚠️ ${escapeHtml(message)}</div>`;
}

// ---------- the three "tools" ----------

async function generate() {
  if (state.ingredients.length === 0) {
    showError("Add at least one ingredient first.");
    return;
  }
  state.preference = preferenceInput.value.trim();
  routeBadge.classList.add("hidden");
  generateBtn.disabled = true;
  try {
    const res = await callAgent(
      "generate",
      { ingredients: state.ingredients, preference: state.preference },
      "Remy is dreaming up recipes…"
    );
    state.recipes = res.recipes || [];
    renderRecipes();
    askCard.classList.remove("hidden");
  } catch (err) {
    showError(err.message);
  } finally {
    generateBtn.disabled = false;
  }
}

async function adapt(tweak) {
  if (!tweak || state.recipes.length === 0) return;
  try {
    const res = await callAgent(
      "adapt",
      { recipes: state.recipes, tweak },
      `Remixing recipes: "${tweak}"…`
    );
    state.recipes = res.recipes || [];
    renderRecipes();
  } catch (err) {
    showError(err.message);
  }
}

async function shop(recipe) {
  try {
    const res = await callAgent(
      "shop",
      { recipe, ingredients: state.ingredients },
      `Building a shopping list for "${recipe.name}"…`
    );
    renderShoppingList(res);
  } catch (err) {
    showError(err.message);
  }
}

// ---------- the ROUTER: agent decides which tool ----------
async function askAgent(text) {
  if (!text.trim()) return;
  askBtn.disabled = true;
  askInput.disabled = true;
  try {
    const decision = await callAgent(
      "route",
      { text, hasRecipes: state.recipes.length > 0 },
      "🧠 Agent is deciding what to do…"
    );
    showRouteBadge(decision);

    if (decision.action === "adapt") {
      await adapt(decision.tweak || text);
    } else if (decision.action === "shop") {
      // find the recipe the user referred to, else default to the first
      const target =
        state.recipes.find((r) =>
          (decision.recipeName || "")
            .toLowerCase()
            .includes(r.name.toLowerCase().slice(0, 6))
        ) || state.recipes[0];
      if (target) await shop(target);
    } else {
      // generate — treat the text as a preference tweak
      if (text) preferenceInput.value = text;
      await generate();
    }
    askInput.value = "";
  } catch (err) {
    showError(err.message);
  } finally {
    askBtn.disabled = false;
    askInput.disabled = false;
  }
}

function showRouteBadge(decision) {
  routeBadge.innerHTML = `<strong>Agent chose: ${escapeHtml(
    decision.action
  )}</strong> ${escapeHtml(decision.reason || "")}`;
  routeBadge.classList.remove("hidden");
}

// ---------- rendering ----------
function renderRecipes() {
  if (!state.recipes.length) {
    resultsEl.innerHTML = "";
    return;
  }
  resultsEl.innerHTML = state.recipes
    .map((r, i) => recipeCard(r, i))
    .join("");

  // wire up per-card buttons
  resultsEl.querySelectorAll("[data-tweak]").forEach((btn) => {
    btn.onclick = () => adapt(btn.dataset.tweak);
  });
  resultsEl.querySelectorAll("[data-shop]").forEach((btn) => {
    btn.onclick = () => shop(state.recipes[Number(btn.dataset.shop)]);
  });
}

function recipeCard(r, i) {
  const have = (r.usesYourIngredients || [])
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");
  const buy = (r.extraIngredients || [])
    .map((x) => `<li>${escapeHtml(x)}</li>`)
    .join("");
  const steps = (r.steps || [])
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join("");

  return `
    <article class="recipe">
      <div class="recipe-head">
        <h3>${escapeHtml(r.name)}</h3>
        <p class="recipe-desc">${escapeHtml(r.description || "")}</p>
        <div class="recipe-meta">
          ${r.time ? `<span class="meta-pill">⏱ ${escapeHtml(r.time)}</span>` : ""}
          ${
            r.difficulty
              ? `<span class="meta-pill">📊 ${escapeHtml(r.difficulty)}</span>`
              : ""
          }
        </div>
      </div>
      <div class="recipe-body">
        <div class="ing-row">
          ${
            have
              ? `<div class="ing-col"><h4>You have</h4><ul class="ing-have">${have}</ul></div>`
              : ""
          }
          ${
            buy
              ? `<div class="ing-col"><h4>You'll need</h4><ul class="ing-buy">${buy}</ul></div>`
              : ""
          }
        </div>
        <ol class="steps">${steps}</ol>
      </div>
      <div class="recipe-actions">
        <button class="tag" data-tweak="make it vegetarian">🥦 Make it veg</button>
        <button class="tag" data-tweak="make it spicier">🌶 Spicier</button>
        <button class="tag" data-tweak="make it a quick 15-minute version">⚡ Quicker</button>
        <button class="tag" data-shop="${i}">🛒 Shopping list</button>
      </div>
    </article>`;
}

function renderShoppingList(data) {
  const items = (data.shoppingList || [])
    .map(
      (it) =>
        `<li><span class="buy-item">${escapeHtml(
          it.item
        )}</span><span class="buy-reason">${escapeHtml(
          it.reason || ""
        )}</span></li>`
    )
    .join("");
  const have = (data.alreadyHave || []).map(escapeHtml).join(", ");

  const card = document.createElement("div");
  card.className = "shop-card";
  card.innerHTML = `
    <h3>🛒 Shopping list — ${escapeHtml(data.recipeName || "")}</h3>
    <ul class="shop-list">${items || "<li>You already have everything! 🎉</li>"}</ul>
    ${have ? `<p class="shop-have">Already in your kitchen: ${have}</p>` : ""}
  `;
  // show the list right at the top of results, above the recipes
  resultsEl.prepend(card);
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ---------- utils ----------
function escapeHtml(str) {
  return String(str).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c])
  );
}

// ---------- events ----------
generateBtn.onclick = generate;
preferenceInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") generate();
});
askBtn.onclick = () => askAgent(askInput.value);
askInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") askAgent(askInput.value);
});
