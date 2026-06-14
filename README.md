# cronometer-mcp

A stateless MCP server for Cronometer nutrition tracking, deployed as Netlify Functions.
Works with Claude.ai, Claude on iPad/iPhone, and any MCP-compatible client.

Built on the reverse-engineered Cronometer mobile REST API (`mobile.cronometer.com`) —
the same endpoints used by the Android/Flutter app. Clean JSON payloads, stable versioned endpoints.

---

## Tools available

| Tool | Description |
|------|-------------|
| `get_food_log` | Diary entries for a date |
| `add_food_entry` | Log a food with exact timestamp |
| `remove_food_entry` | Remove a diary entry by ID |
| `copy_day` | Copy all entries from one day to another |
| `mark_day_complete` | Mark a day complete/incomplete |
| `get_nutrition_summary` | Daily macro/micro totals |
| `get_nutrition_scores` | Per-nutrient confidence grades |
| `search_foods` | Search the food database |
| `get_food_details` | Full nutrition info for a food |
| `add_custom_food` | Create a custom food |
| `get_macro_targets` | Weekly targets and templates |
| `get_fasting_history` | Fasting history by date range |
| `get_fasting_stats` | Aggregate fasting statistics |

---

## Deploy to Netlify (5 minutes)

### 1. Fork / clone this repo and push to your GitHub

### 2. Create a new Netlify site
- Go to [netlify.com](https://netlify.com) → Add new site → Import from GitHub
- Select this repo
- Build settings are auto-detected from `netlify.toml`
- Click **Deploy**

### 3. Set environment variables
In Netlify → Site → **Environment variables**, add:

| Variable | Value |
|----------|-------|
| `CRONOMETER_USERNAME` | `jjsander@gmail.com` |
| `CRONOMETER_PASSWORD` | your Cronometer password |
| `MCP_AUTH_TOKEN` | any long random string (e.g. `openssl rand -hex 32`) |
| `CRONOMETER_USER_ID` | *(leave blank initially — see step 5)* |
| `CRONOMETER_SESSION_TOKEN` | *(leave blank initially — see step 5)* |

### 4. Redeploy after setting env vars
Netlify → Deploys → **Trigger deploy**

### 5. Cache your session token (avoids re-login on every request)
After your first real tool call, check **Netlify → Functions → mcp → Logs**.
You'll see:
```
[cronometer-mcp] LOGIN SUCCESS — set these env vars to cache the session:
  CRONOMETER_USER_ID=12345
  CRONOMETER_SESSION_TOKEN=eyJ...
```
Copy those values into your Netlify env vars and redeploy.
Tokens are long-lived (days/weeks) and will auto-refresh in the logs when they expire.

---

## Connect to Claude.ai

1. Go to **claude.ai → Settings → Integrations → Add custom integration**
2. Name: `Cronometer`
3. URL: `https://your-site-name.netlify.app/mcp`
4. Auth: Bearer token → paste your `MCP_AUTH_TOKEN`
5. Save

Claude can now read and write your Cronometer diary from any device.

---

## Local development

```bash
npm install
# Install Netlify CLI if you haven't
npm install -g netlify-cli

# Create a .env file
cp .env.example .env
# Fill in your credentials

netlify dev
# MCP server available at http://localhost:8888/mcp
```

---

## Credits
API endpoints reverse-engineered by [rwestergren/cronometer-api-mcp](https://github.com/rwestergren/cronometer-api-mcp).
