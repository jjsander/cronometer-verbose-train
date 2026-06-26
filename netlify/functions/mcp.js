/**
 * Cronometer MCP Server — Netlify Function
 *
 * Implements the MCP Streamable HTTP (stateless) transport.
 * Each request is a complete MCP exchange: initialize, list tools, or call tool.
 *
 * Env vars required:
 *   CRONOMETER_USERNAME       — your Cronometer login email
 *   CRONOMETER_PASSWORD       — your Cronometer password
 *   CRONOMETER_USER_ID        — cached after first login (set in Netlify dashboard)
 *   CRONOMETER_SESSION_TOKEN  — cached after first login (set in Netlify dashboard)
 *   MCP_AUTH_TOKEN            — a secret token Claude uses to authenticate to this server
 */

import * as crono from './cronometer.js';
import { login } from './cronometer.js';
import {
  getPermutationHash,
  addFood as gwtAddFood,
  editFood as gwtEditFood,
  parseFoodIdFromResponse,
  makeNutrientMap,
  NUTRIENT_ID,
} from './gwt.js';

// ── MCP Tool Definitions ──────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_food_log',
    description: 'Get diary entries for a specific date. Returns all food items logged, with meal group, serving size, and energy.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format. Defaults to today.' },
      },
    },
  },
  {
    name: 'add_food_entry',
    description: 'Add a food entry to the Cronometer diary. Use search_foods first to get foodId and measureId.',
    inputSchema: {
      type: 'object',
      required: ['foodId', 'measureId', 'quantity'],
      properties: {
        foodId:    { type: 'string',  description: 'Cronometer food ID from search_foods.' },
        measureId: { type: 'string',  description: 'Serving size ID from search_foods measures array.' },
        quantity:  { type: 'number',  description: 'Number of servings.' },
        mealName:  { type: 'string',  description: 'Meal group e.g. Breakfast, Lunch, Dinner, Snacks. Defaults to Snacks.' },
        timestamp: { type: 'string',  description: 'ISO 8601 datetime e.g. 2025-06-14T08:30:00. Defaults to now.' },
        date:      { type: 'string',  description: 'Date in YYYY-MM-DD format. Defaults to today.' },
      },
    },
  },
  {
    name: 'remove_food_entry',
    description: 'Remove a food entry from the diary by its serving ID (returned in get_food_log).',
    inputSchema: {
      type: 'object',
      required: ['servingId'],
      properties: {
        servingId: { type: 'string', description: 'The serving ID to remove.' },
      },
    },
  },
  {
    name: 'copy_day',
    description: 'Copy all diary entries from one day to another.',
    inputSchema: {
      type: 'object',
      required: ['fromDate', 'toDate'],
      properties: {
        fromDate: { type: 'string', description: 'Source date YYYY-MM-DD.' },
        toDate:   { type: 'string', description: 'Destination date YYYY-MM-DD.' },
      },
    },
  },
  {
    name: 'mark_day_complete',
    description: 'Mark a diary day as complete or incomplete.',
    inputSchema: {
      type: 'object',
      required: ['date'],
      properties: {
        date:     { type: 'string',  description: 'Date YYYY-MM-DD.' },
        complete: { type: 'boolean', description: 'True to mark complete, false to unmark. Defaults to true.' },
      },
    },
  },
  {
    name: 'get_nutrition_summary',
    description: 'Get daily macro and micronutrient totals for a date — calories, protein, carbs, fat, vitamins, minerals, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'get_nutrition_scores',
    description: 'Get nutrition scores with per-nutrient confidence grades for a date.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'search_foods',
    description: 'Search the Cronometer food database by name. Returns foodId, name, brand, and available serving sizes with measureIds.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Food name to search for.' },
        limit: { type: 'number', description: 'Max results to return. Defaults to 20.' },
      },
    },
  },
  {
    name: 'get_food_details',
    description: 'Get full nutrition details for a specific food by its Cronometer food ID.',
    inputSchema: {
      type: 'object',
      required: ['foodId'],
      properties: {
        foodId: { type: 'string', description: 'Cronometer food ID.' },
      },
    },
  },
  {
    name: 'add_custom_food',
    description: 'Create a custom food in Cronometer with specified nutrition values.',
    inputSchema: {
      type: 'object',
      required: ['name', 'servingName', 'servingGrams', 'nutrition'],
      properties: {
        name:         { type: 'string', description: 'Food name.' },
        servingName:  { type: 'string', description: 'Serving size name e.g. "1 cup".' },
        servingGrams: { type: 'number', description: 'Grams per serving.' },
        nutrition: {
          type: 'object',
          description: 'Nutrient values object e.g. { energy: 200, protein: 10, carbs: 25, fat: 5 }',
        },
      },
    },
  },
  {
    name: 'get_macro_targets',
    description: 'Get current macro targets including weekly schedule and saved templates.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_fasting_history',
    description: 'Get fasting history between two dates.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start date YYYY-MM-DD. Defaults to 30 days ago.' },
        endDate:   { type: 'string', description: 'End date YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'get_fasting_stats',
    description: 'Get aggregate fasting statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_recipe',
    description: `Create a new recipe in Cronometer via the GWT web API.
Ingredients are specified as an array of food items with their serving amounts.
Nutrient values are computed automatically from ingredients if not provided — supply 'nutrients' to override.
Returns the new recipe's foodId on success.`,
    inputSchema: {
      type: 'object',
      required: ['name', 'ingredients', 'servingGrams'],
      properties: {
        name:         { type: 'string',  description: 'Recipe name.' },
        servingGrams: { type: 'number',  description: 'Total grams for the primary serving (e.g. total weight of the recipe batch).' },
        servingName:  { type: 'string',  description: 'Label for the primary serving, e.g. "full recipe" or "1 serving". Defaults to "full recipe".' },
        note:         { type: 'string',  description: 'Optional note.' },
        ingredients: {
          type: 'array',
          description: 'List of ingredients.',
          items: {
            type: 'object',
            required: ['foodId', 'measureId', 'grams'],
            properties: {
              foodId:    { type: 'number', description: 'Cronometer food ID.' },
              measureId: { type: 'number', description: 'Measure ID for the serving used.' },
              grams:     { type: 'number', description: 'Grams of this ingredient in the recipe.' },
            },
          },
        },
        nutrients: {
          type: 'object',
          description: 'Optional nutrient overrides. Keys are nutrient names (energy, protein, fat, carbs, fiber, sugars, sodium, etc.) or numeric Cronometer nutrient IDs. Values are amounts in standard units (g, mg, kcal).',
        },
      },
    },
  },
  {
    name: 'update_recipe',
    description: `Update an existing recipe in Cronometer via the GWT web API.
The foodId of the recipe to edit is required. All ingredient and nutrient values are replaced.
Returns the recipe's foodId on success.`,
    inputSchema: {
      type: 'object',
      required: ['foodId', 'primaryMeasureId', 'name', 'ingredients', 'servingGrams'],
      properties: {
        foodId:           { type: 'number', description: 'Existing recipe food ID.' },
        primaryMeasureId: { type: 'number', description: 'Primary measure ID of the existing recipe (returned by get_food_details or create_recipe).' },
        name:             { type: 'string', description: 'Recipe name.' },
        servingGrams:     { type: 'number', description: 'Total grams for the primary serving.' },
        servingName:      { type: 'string', description: 'Label for the primary serving. Defaults to "full recipe".' },
        note:             { type: 'string', description: 'Optional note.' },
        ingredients: {
          type: 'array',
          items: {
            type: 'object',
            required: ['foodId', 'measureId', 'grams'],
            properties: {
              foodId:        { type: 'number', description: 'Cronometer food ID.' },
              measureId:     { type: 'number', description: 'Measure ID.' },
              grams:         { type: 'number', description: 'Grams of this ingredient.' },
              ingredientId:  { type: 'string', description: 'Existing ingredient ID (from prior editFood response). Omit for new ingredients.' },
            },
          },
        },
        nutrients: {
          type: 'object',
          description: 'Optional nutrient overrides (same as create_recipe).',
        },
      },
    },
  },
  {
    name: 'get_gwt_permutation',
    description: 'Diagnostic: fetch the current GWT permutation hash from cronometer.nocache.js. Useful to verify auto-discovery is working and to compare against a freshly captured HAR.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Date helpers ──────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ── Session management ────────────────────────────────────────────────────────

/**
 * Get a valid session, re-logging in if needed.
 * On first login, logs the userId and token to the Netlify function log
 * so you can copy them into env vars (avoids login on every request).
 */
async function getSession() {
  let userId = process.env.CRONOMETER_USER_ID;
  let token  = process.env.CRONOMETER_SESSION_TOKEN;

  if (!userId || !token) {
    console.log('[cronometer-mcp] No cached session, logging in...');
    const session = await login(
      process.env.CRONOMETER_USERNAME,
      process.env.CRONOMETER_PASSWORD,
    );
    userId = String(session.userId);
    token  = session.token;
    // Log so you can copy into Netlify env vars
    console.log(`[cronometer-mcp] LOGIN SUCCESS — set these env vars to cache the session:`);
    console.log(`  CRONOMETER_USER_ID=${userId}`);
    console.log(`  CRONOMETER_SESSION_TOKEN=${token}`);
  }

  return { userId, token };
}

// ── Enriched food log — resolves food names from IDs ─────────────────────────

async function getFoodLogEnriched(userId, token, date) {
  const raw = await crono.getFoodLog(userId, token, date);

  // Pull only food serving entries (skip biometrics and exercise)
  const servings = (raw?.diary?.diary || []).filter(e => e.type === 'Serving');

  // Batch-fetch food details for all unique foodIds in parallel
  const uniqueFoodIds = [...new Set(servings.map(e => e.foodId))];
  const foodDetails = await Promise.all(
    uniqueFoodIds.map(id =>
      crono.getFoodDetails(userId, token, id).catch(() => ({ foodId: id, name: `Unknown (${id})` }))
    )
  );

  // Build a lookup map: foodId → { name, measures }
  const foodMap = {};
  foodDetails.forEach(f => {
    const id = f.foodId || f.id;
    foodMap[id] = {
      name: f.name || f.foodName || `Unknown (${id})`,
      measures: f.measures || [],
    };
  });

  // Enrich each serving with name and serving description
  const enrichedServings = servings.map(entry => {
    const food = foodMap[entry.foodId] || {};
    const measure = (food.measures || []).find(m => m.id === entry.measureId || m.measureId === entry.measureId);
    return {
      servingId:   entry.servingId,
      foodId:      entry.foodId,
      name:        food.name || `Unknown (${entry.foodId})`,
      grams:       entry.grams,
      servingDesc: measure ? `${measure.name || measure.servingName} (${entry.grams}g)` : `${entry.grams}g`,
      meal:        mealFromOrder(entry.order),
    };
  });

  // Return enriched log alongside the original summary data
  return {
    date,
    energy_summary:    raw.energy_summary,
    nutrition_summary: raw.nutrition_summary,
    foods: enrichedServings,
    exercise: (raw?.diary?.diary || [])
      .filter(e => e.type === 'Exercise')
      .map(e => ({ name: e.name, minutes: e.minutes, calories: Math.abs(e.calories || 0) })),
  };
}

// Cronometer encodes meal slot in the high bits of the order field
function mealFromOrder(order) {
  if (!order) return 'Uncategorized';
  const slot = order >> 16;
  const meals = { 0: 'Breakfast', 1: 'Lunch', 2: 'Dinner', 3: 'Snacks', 4: 'Uncategorized' };
  return meals[slot] ?? 'Uncategorized';
}

// ── Nutrient resolution ───────────────────────────────────────────────────────

/**
 * Build the nutrient map for a recipe GWT call.
 * If the caller supplied explicit nutrients, use those directly.
 * Otherwise, fetch each ingredient's nutrition via REST and sum the macros.
 * Falls back to zeros on any fetch error (logs a warning).
 */
async function resolveNutrients(userId, token, ingredients, explicitNutrients) {
  if (explicitNutrients && Object.keys(explicitNutrients).length > 0) {
    return makeNutrientMap(explicitNutrients);
  }

  // Compute from ingredients
  const totals = {};
  await Promise.all(ingredients.map(async ing => {
    try {
      const detail = await crono.getFoodDetails(userId, token, ing.foodId);
      // REST API returns nutrition per 100g in a 'nutrients' object keyed by name
      // Scale by (ing.grams / 100)
      const scale = ing.grams / 100;
      const src = detail?.nutrients ?? detail?.nutrition ?? {};
      for (const [k, v] of Object.entries(src)) {
        const numKey = isNaN(Number(k)) ? k : Number(k);
        totals[numKey] = (totals[numKey] ?? 0) + (v ?? 0) * scale;
      }
    } catch (err) {
      console.warn(`[resolveNutrients] Could not fetch details for foodId ${ing.foodId}:`, err.message);
    }
  }));

  // Map named nutrient keys to Cronometer GWT IDs
  const named = {};
  for (const [k, v] of Object.entries(totals)) {
    if (NUTRIENT_ID[k] !== undefined) {
      named[NUTRIENT_ID[k]] = (named[NUTRIENT_ID[k]] ?? 0) + v;
    } else if (!isNaN(Number(k))) {
      named[Number(k)] = (named[Number(k)] ?? 0) + v;
    }
  }

  return makeNutrientMap(named);
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

async function callTool(name, args) {
  const { userId, token } = await getSession();

  switch (name) {
    case 'get_food_log':
      return crono.getFoodLog(userId, token, args.date || today());

    case 'add_food_entry':
      return crono.addFoodEntry(userId, token, {
        foodId:    args.foodId,
        measureId: args.measureId,
        quantity:  args.quantity,
        mealName:  args.mealName  || 'Snacks',
        timestamp: args.timestamp || new Date().toISOString().slice(0, 19),
        date:      args.date      || today(),
      });

    case 'remove_food_entry':
      return crono.removeFoodEntry(userId, token, args.servingId);

    case 'copy_day':
      return crono.copyDay(userId, token, args.fromDate, args.toDate);

    case 'mark_day_complete':
      return crono.markDayComplete(userId, token, args.date, args.complete ?? true);

    case 'get_nutrition_summary':
      return crono.getNutritionSummary(userId, token, args.date || today());

    case 'get_nutrition_scores':
      return crono.getNutritionScores(userId, token, args.date || today());

    case 'search_foods':
      return crono.searchFoods(userId, token, args.query, args.limit || 20);

    case 'get_food_details':
      return crono.getFoodDetails(userId, token, args.foodId);

    case 'add_custom_food':
      return crono.addCustomFood(userId, token, {
        name:         args.name,
        servingName:  args.servingName,
        servingGrams: args.servingGrams,
        nutrition:    args.nutrition,
      });

    case 'get_macro_targets':
      return crono.getMacroTargets(userId, token);

    case 'get_fasting_history':
      return crono.getFastingHistory(
        userId, token,
        args.startDate || daysAgo(30),
        args.endDate   || today(),
      );

    case 'get_fasting_stats':
      return crono.getFastingStats(userId, token);

    case 'create_recipe': {
      const nutrients = await resolveNutrients(userId, token, args.ingredients, args.nutrients);
      const raw = await gwtAddFood(token, parseInt(userId), {
        name:         args.name,
        servingName:  args.servingName || 'full recipe',
        servingGrams: args.servingGrams,
        ingredients:  args.ingredients,
        nutrients,
        note:         args.note || '',
        foodType:     1,
      });
      const foodId = parseFoodIdFromResponse(raw);
      return { success: true, foodId, message: `Recipe "${args.name}" created with food ID ${foodId}.` };
    }

    case 'update_recipe': {
      const nutrients = await resolveNutrients(userId, token, args.ingredients, args.nutrients);
      const raw = await gwtEditFood(token, parseInt(userId), args.foodId, args.primaryMeasureId, {
        name:         args.name,
        servingName:  args.servingName || 'full recipe',
        servingGrams: args.servingGrams,
        ingredients:  args.ingredients,
        nutrients,
        note:         args.note || '',
      });
      const foodId = parseFoodIdFromResponse(raw);
      return { success: true, foodId, message: `Recipe "${args.name}" updated (food ID ${foodId}).` };
    }

    case 'get_gwt_permutation': {
      const hash = await getPermutationHash();
      return { permutation_hash: hash, header_name: 'X-GWT-Permutation', source: 'cronometer.nocache.js' };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP message handler ───────────────────────────────────────────────────────

async function handleMcpMessage(message) {
  const { id, method, params } = message;

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: { name: 'cronometer-mcp', version: '1.0.0' },
          },
        };

      case 'tools/list':
        return {
          jsonrpc: '2.0', id,
          result: { tools: TOOLS },
        };

      case 'tools/call': {
        const { name, arguments: args } = params;
        const result = await callTool(name, args || {});
        return {
          jsonrpc: '2.0', id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        };
      }

      case 'notifications/initialized':
        return null; // no response needed

      default:
        return {
          jsonrpc: '2.0', id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  } catch (err) {
    console.error(`[cronometer-mcp] Tool error (${message.method}):`, err.message);
    return {
      jsonrpc: '2.0', id,
      error: { code: -32603, message: err.message },
    };
  }
}

// ── Netlify Function entrypoint ───────────────────────────────────────────────

export default async function handler(req, context) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Auth check
  const authHeader = req.headers.get('authorization') || '';
  const expectedToken = process.env.MCP_AUTH_TOKEN;
  if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Parse body
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  // Handle batch or single message
  const messages = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(messages.map(handleMcpMessage))).filter(Boolean);

  const responseBody = Array.isArray(body) ? responses : responses[0];

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export const config = { path: '/mcp' };
