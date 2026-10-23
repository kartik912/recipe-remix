// Vercel serverless function — the "brain" of Recipe Remix.
//
// Why this file exists: the Gemini API key must NEVER live in browser code
// (anyone could open DevTools and steal it). The browser talks only to THIS
// function; this function holds the key as a server-side env var and forwards
// the request to Gemini.
//
// The frontend sends { action, data }. `action` is the "tool" the agent runs:
//   - "route"    : agent reads free text and decides which tool to use
//   - "generate" : ingredients        -> 3 recipe ideas
//   - "adapt"    : recipes + a tweak  -> modified recipes
//   - "shop"     : one recipe + what you own -> shopping list

// Google retires / throttles models often, so we keep a fallback chain.
// The function tries these in order and moves on if one is 404 (retired) or
// 503 (overloaded). Reorder/extend this list if availability changes again.
const MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-flash-lite-latest",
];

const modelUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// ---- Response shapes we force Gemini to return (so the UI can render cards) ----

const RECIPE_SCHEMA = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING" },
    description: { type: "STRING" },
    time: { type: "STRING", description: "e.g. '25 min'" },
    difficulty: { type: "STRING", description: "Easy, Medium or Hard" },
    usesYourIngredients: { type: "ARRAY", items: { type: "STRING" } },
    extraIngredients: { type: "ARRAY", items: { type: "STRING" } },
    steps: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["name", "description", "time", "difficulty", "steps"],
};

const RECIPES_SCHEMA = {
  type: "OBJECT",
  properties: { recipes: { type: "ARRAY", items: RECIPE_SCHEMA } },
  required: ["recipes"],
};

const SHOP_SCHEMA = {
  type: "OBJECT",
  properties: {
    recipeName: { type: "STRING" },
    shoppingList: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          item: { type: "STRING" },
          reason: { type: "STRING" },
        },
        required: ["item"],
      },
    },
    alreadyHave: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["recipeName", "shoppingList"],
};

const ROUTE_SCHEMA = {
  type: "OBJECT",
  properties: {
    action: { type: "STRING", enum: ["generate", "adapt", "shop"] },
    reason: { type: "STRING", description: "one short sentence, friendly" },
    tweak: { type: "STRING", description: "the modification, if action is adapt" },
    recipeName: { type: "STRING", description: "target recipe, if action is shop" },
  },
  required: ["action", "reason"],
};

// ---- Helper: one call to Gemini, returns parsed JSON ----

async function callGemini({ system, prompt, schema, temperature = 0.8 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it in Vercel (Settings → Environment Variables) or your local .env file."
    );
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: system }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature,
    },
  };

  let lastError = "";
  for (const model of MODELS) {
    const resp = await fetch(`${modelUrl(model)}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    // 404 = model retired, 503 = overloaded — try the next model in the chain
    if (resp.status === 404 || resp.status === 503) {
      lastError = `${model} unavailable (${resp.status})`;
      continue;
    }

    if (!resp.ok) {
      const detail = await resp.text();
      throw new Error(`Gemini API error (${resp.status}): ${detail}`);
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned an empty response.");
    return JSON.parse(text);
  }

  throw new Error(
    `All Gemini models are currently unavailable. Last: ${lastError}`
  );
}

// ---- Prompt builders for each tool ----

const CHEF_PERSONA =
  "You are Remy, a warm, creative home-cook AI. You suggest practical, tasty recipes " +
  "that waste as little food as possible. Keep steps short and clear for a beginner.";

function buildGenerate(data) {
  const { ingredients = [], preference = "" } = data;
  return {
    system: CHEF_PERSONA,
    schema: RECIPES_SCHEMA,
    prompt:
      `The cook has these ingredients: ${ingredients.join(", ") || "(none listed)"}.\n` +
      (preference ? `Preference / constraint: ${preference}.\n` : "") +
      `Suggest exactly 3 different recipes they could realistically make. ` +
      `Prefer recipes that mostly use what they already have. ` +
      `In usesYourIngredients list only items from their list; in extraIngredients list ` +
      `common things they'd likely need to buy.`,
  };
}

function buildAdapt(data) {
  const { recipes = [], tweak = "" } = data;
  return {
    system: CHEF_PERSONA,
    schema: RECIPES_SCHEMA,
    temperature: 0.7,
    prompt:
      `Here are the current recipes as JSON:\n${JSON.stringify(recipes)}\n\n` +
      `Rewrite ALL of them to genuinely satisfy this request: "${tweak}".\n\n` +
      `Rules:\n` +
      `- Actually APPLY the change. If an ingredient conflicts with the request, ` +
      `REMOVE it — do not just add new ingredients on top of it.\n` +
      `- "Vegetarian" means NO meat, NO poultry, NO fish or seafood, and NO eggs. ` +
      `Replace them with vegetarian options (e.g. paneer, tofu, mushrooms, beans, extra veg).\n` +
      `- "Vegan" additionally means no dairy and no honey.\n` +
      `- After changing ingredients, REWRITE the name, steps, usesYourIngredients ` +
      `and extraIngredients to match. Any removed ingredient must disappear from every ` +
      `list and from every step.\n` +
      `- Keep the same number of recipes.`,
  };
}

function buildShop(data) {
  const { recipe = {}, ingredients = [] } = data;
  return {
    system: CHEF_PERSONA,
    schema: SHOP_SCHEMA,
    temperature: 0.4,
    prompt:
      `The cook wants to make this recipe:\n${JSON.stringify(recipe)}\n\n` +
      `They already own: ${ingredients.join(", ") || "(nothing specified)"}.\n` +
      `Produce a shopping list of ONLY the items they still need to buy (with a short ` +
      `reason each), and list which required items they already have.`,
  };
}

function buildRoute(data) {
  const { text = "", hasRecipes = false } = data;
  return {
    system:
      "You are the router for a cooking assistant. Decide which tool fits the user's " +
      "message. Tools: 'generate' (they want recipe ideas from ingredients), " +
      "'adapt' (they want to change the recipes already on screen — e.g. make it " +
      "vegetarian, spicier, quicker), 'shop' (they want a shopping list for a recipe). " +
      `There ${hasRecipes ? "ARE" : "are NO"} recipes currently on screen.`,
    schema: ROUTE_SCHEMA,
    temperature: 0.2,
    prompt: `User said: "${text}". Pick the best tool and explain briefly why.`,
  };
}

// ---- Handler ----

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  try {
    const { action, data = {} } = req.body || {};
    let built;
    switch (action) {
      case "generate":
        built = buildGenerate(data);
        break;
      case "adapt":
        built = buildAdapt(data);
        break;
      case "shop":
        built = buildShop(data);
        break;
      case "route":
        built = buildRoute(data);
        break;
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    const result = await callGemini(built);
    return res.status(200).json(result);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Something went wrong." });
  }
}
