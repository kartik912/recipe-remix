# 🥘 Recipe Remix

An **AI agent** that turns the ingredients you already have into recipes — then
remixes them to your taste and builds a shopping list for what's missing.

Built for the company AI Showcase with the simplest possible stack:

- **Vanilla HTML + CSS + JavaScript** — no framework
- **One Vercel serverless function** (`api/ask.js`) that keeps the API key secret
- **Google Gemini** (`gemini-3.6-flash`, with automatic fallback to other models) — free tier, no credit card

## Why it's an "AI agent" (the showcase angle)

Based on what you ask, the agent routes to one of three tools and shows its decision:

| Tool | What it does |
|------|--------------|
| 🍳 **generate** | ingredients → 3 recipe ideas |
| 🔀 **adapt** | remix recipes ("make it vegetarian", "spicier", "quicker") |
| 🛒 **shop** | build a shopping list for a recipe |

Type into the **"Ask the agent"** box (e.g. *"make them vegetarian"* or *"shopping
list for recipe 2"*) and it decides which tool to run — and tells you why.

---

## 1. Get a free Gemini API key (2 min)

1. Go to **https://aistudio.google.com/apikey**
2. Sign in with a Google account → **Create API key**
3. Copy the key (starts with `AIza…`)

No billing or credit card required for the free tier.

## 2. Test it locally

```bash
# 1. put your key in a .env file
cp .env.example .env          # then edit .env and paste your key
                              # (on Windows PowerShell: copy .env.example .env)

# 2. run the smoke test
node test-gemini.mjs
```

You should see `✅ SUCCESS` and a couple of sample recipes.

### Run the full app locally (optional)

The app needs the serverless function, so use the Vercel CLI:

```bash
npm i -g vercel      # one time
vercel dev           # serves the site + /api/ask at http://localhost:3000
```

> Opening `index.html` directly (file://) will **not** work — `/api/ask` needs a
> server. Use `vercel dev`.

---

## 3. Deploy to Vercel (free)

### Option A — GitHub (recommended, auto-deploys)

1. Push this folder to a GitHub repo.
2. Go to **https://vercel.com** → sign in with GitHub → **Add New → Project**.
3. Import the repo. Vercel auto-detects it (no build step needed).
4. Before deploying, open **Environment Variables** and add:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** your key
5. Click **Deploy**. Done — you get a live `*.vercel.app` URL.

> Every future `git push` redeploys automatically.

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel                                   # deploy a preview
vercel env add GEMINI_API_KEY            # paste your key when prompted
vercel --prod                            # deploy to production
```

---

## Project structure

```
index.html        the UI
styles.css        styling
app.js            frontend logic + agent routing
api/ask.js        serverless function (holds the key, calls Gemini)
test-gemini.mjs   local smoke test
vercel.json       serverless config
```

## Security note

The Gemini key lives **only** on the server (as the `GEMINI_API_KEY` env var) and
is never sent to the browser. `.env` is git-ignored so your key never gets
committed. This is the right pattern even for a demo.
