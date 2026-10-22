// Quick smoke test — confirms your GEMINI_API_KEY works and that the model
// returns the structured JSON our app relies on.
//
//   1. Put your key in a .env file (see .env.example)
//   2. Run:  node test-gemini.mjs
//
// No npm install needed — uses Node's built-in fetch (Node 18+).

import fs from "node:fs";

// --- load .env manually (no dependency) ---
function loadEnv() {
  try {
    const raw = fs.readFileSync(new URL("./.env", import.meta.url), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* no .env file — maybe the var is already in the environment */
  }
}
loadEnv();

const key = process.env.GEMINI_API_KEY;
if (!key || key === "your_key_here") {
  console.error(
    "\n❌ No GEMINI_API_KEY found.\n   Create a .env file with: GEMINI_API_KEY=your_real_key\n"
  );
  process.exit(1);
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const body = {
  contents: [
    {
      parts: [
        {
          text: "Ingredients: eggs, rice, chicken, soy sauce. Suggest exactly 2 quick recipes.",
        },
      ],
    },
  ],
  systemInstruction: {
    parts: [{ text: "You are a helpful home-cook AI. Keep it simple." }],
  },
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: {
      type: "OBJECT",
      properties: {
        recipes: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              time: { type: "STRING" },
              steps: { type: "ARRAY", items: { type: "STRING" } },
            },
            required: ["name", "steps"],
          },
        },
      },
      required: ["recipes"],
    },
  },
};

console.log("⏳ Calling Gemini (gemini-2.5-flash)…");

try {
  const resp = await fetch(`${GEMINI_URL}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.error(`\n❌ Gemini returned HTTP ${resp.status}:`);
    console.error(await resp.text());
    process.exit(1);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  const parsed = JSON.parse(text);

  console.log("\n✅ SUCCESS — key works and JSON parsed cleanly.\n");
  parsed.recipes.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.name}  (${r.time || "n/a"}) — ${r.steps.length} steps`);
  });
  console.log("\nYou're good to deploy. 🚀\n");
} catch (err) {
  console.error("\n❌ Test failed:", err.message, "\n");
  process.exit(1);
}
