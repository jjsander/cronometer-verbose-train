/**
 * Cronometer GWT-RPC client
 *
 * Cronometer's web app uses GWT for recipe and custom-food operations
 * not exposed via the mobile REST API.
 *
 * Two distinct identifiers — never conflate them:
 *   GWT_PERMUTATION  — X-GWT-Permutation HTTP header; rotates on every Cronometer deploy.
 *                      Auto-discovered from cronometer.nocache.js; cached 24h in memory.
 *   GWT_TYPE_SIG     — in-body RPC type signature hash; stable across deploys.
 *
 * Auth: the GWT session token (in-body param) is the same credential as the
 * mobile REST session token (CRONOMETER_SESSION_TOKEN env var).
 *
 * Endpoints:
 *   GWT-RPC:   POST https://cronometer.com/cronometer/app
 *   Bootstrap: GET  https://cronometer.com/cronometer/cronometer.nocache.js
 */

const NOCACHE_URL = 'https://cronometer.com/cronometer/cronometer.nocache.js';
const GWT_RPC_URL = 'https://cronometer.com/cronometer/app';
const MODULE_BASE = 'https://cronometer.com/cronometer/';

// Stable in-body type signature. Distinct from X-GWT-Permutation.
const GWT_TYPE_SIG = 'F25561B47C31168F0ED80B768B647985';

// Permutation hash cache — auto-refreshed when stale
let _permCache = { hash: null, fetchedAt: 0 };
const PERM_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ── Permutation hash auto-discovery ──────────────────────────────────────────

/**
 * Fetch and cache the current X-GWT-Permutation hash from cronometer.nocache.js.
 * Cronometer rotates this on every deploy; we re-fetch when our cache is >24h old.
 */
export async function getPermutationHash() {
  const now = Date.now();
  if (_permCache.hash && now - _permCache.fetchedAt < PERM_CACHE_TTL_MS) {
    return _permCache.hash;
  }

  const res = await fetch(NOCACHE_URL, {
    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch GWT bootstrap: ${res.status}`);
  }
  const js = await res.text();

  // Hash is a 32-char uppercase hex literal: Nb='9186A50F5E0928943ED9160294750920'
  const matches = js.match(/'([0-9A-F]{32})'/g);
  if (!matches?.length) {
    throw new Error('GWT permutation hash not found in cronometer.nocache.js');
  }
  const hash = matches[0].replace(/'/g, '');
  _permCache = { hash, fetchedAt: now };
  console.log(`[gwt] Permutation hash refreshed: ${hash}`);
  return hash;
}

/** Force-expire the permutation cache (call after a 403/unexpected GWT error). */
export function invalidatePermutationCache() {
  _permCache = { hash: null, fetchedAt: 0 };
}

// ── Low-level GWT-RPC transport ───────────────────────────────────────────────

/**
 * Send a GWT-RPC payload string. Returns the raw response body.
 * Throws on HTTP error or //EX server exception.
 * On 403, invalidates the permutation cache automatically.
 */
async function gwtPost(payload, methodHint = '', sessionToken = '') {
  const permHash = await getPermutationHash();
  const headers = {
    'Content-Type': 'text/x-gwt-rpc; charset=UTF-8',
    'X-GWT-Permutation': permHash,
    'X-GWT-Module-Base': MODULE_BASE,
    'User-Agent': 'cronometer-mcp/1.0',
    'Referer': 'https://cronometer.com/',
  };
  if (sessionToken) headers['Cookie'] = `sesnonce=${sessionToken}`;
  const res = await fetch(GWT_RPC_URL, { method: 'POST', headers, body: payload });

  if (res.status === 403) {
    invalidatePermutationCache();
    throw new Error(`GWT-RPC 403 for ${methodHint} — permutation hash expired and cache invalidated. Retry once.`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GWT-RPC ${methodHint} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const text = await res.text();
  if (text.startsWith('//EX')) {
    throw new Error(`GWT-RPC server exception (${methodHint}): ${text.slice(0, 500)}`);
  }
  return text;
}

// ── Payload builder ───────────────────────────────────────────────────────────

/**
 * Build a GWT-RPC v7 payload.
 *
 * Wire format: 7|0|N|s[1]|...|s[N]|<tokens>|
 *
 * @param {string[]} strings  - Ordered string table (1-indexed in tokens)
 * @param {(string|number)[]} tokens - Data section values
 */
function buildPayload(strings, tokens) {
  return `7|0|${strings.length}|${strings.join('|')}|${tokens.join('|')}|`;
}

// ── Shared string-table constants ─────────────────────────────────────────────
// These are GWT class-name type hashes — stable across Cronometer deploys.

const T_MODULE_BASE  = MODULE_BASE;
const T_TYPE_SIG     = GWT_TYPE_SIG;
const T_SERVICE      = 'com.cronometer.shared.rpc.CronometerService';
const T_STRING_TYPE  = 'java.lang.String/2004016611';
const T_INT_TYPE     = 'I';
const T_FOOD         = 'com.cronometer.shared.foods.models.Food/2097636843';
const T_INGR_SUBS    = 'com.cronometer.shared.foods.models.IngredientSubstitutions/1892525086';
const T_ARRAYLIST    = 'java.util.ArrayList/4159755760';
const T_INGREDIENT   = 'com.cronometer.shared.foods.models.Ingredient/1280520736';
const T_NUTR_LABEL   = 'com.cronometer.shared.foods.NutritionLabelType/1598919019';
const T_FOOD_MEAS    = 'com.cronometer.shared.foods.models.FoodMeasures/2106205728';
const T_MEASURE      = 'com.cronometer.shared.foods.models.Measure/824760657';
const T_MEAS_TYPE    = 'com.cronometer.shared.foods.models.Measure$Type/2365167904';
const T_NUTRIENT_MAP = 'com.cronometer.shared.foods.models.NutrientMap/168231382';
const T_NUTR_FILTER  = 'com.cronometer.shared.foods.models.NutrientMap$NutrientFilter/1990310964';
const T_HASHMAP      = 'java.util.HashMap/1797211028';
const T_INTEGER      = 'java.lang.Integer/3438268394';
const T_NUTRIENT     = 'com.cronometer.shared.foods.models.Nutrient/331784102';
const T_NUTR_TYPE    = 'com.cronometer.shared.foods.models.Nutrient$Type/4187872513';
const T_HASHSET      = 'java.util.HashSet/3273092938';
const T_TRANSLATION  = 'com.cronometer.shared.foods.models.Translation/4034452093';
const T_LANGUAGE     = 'com.cronometer.shared.user.models.Language/1257207975';
const T_FOOD_TYPE    = 'com.cronometer.shared.foods.FoodType/2323555378';

// ── Nutrient map helpers ──────────────────────────────────────────────────────

/**
 * USDA/Cronometer nutrient IDs used in the GWT Food object.
 * Confirmed from HAR capture of addFood / editFood calls.
 * Negative IDs are Cronometer-specific (kcal contributions by macro).
 */
export const NUTRIENT_ID = {
  energy:        208,
  protein:       203,
  fat:           204,
  carbs:         205,
  fiber:         291,
  sugars:        269,
  added_sugars:  -1205,
  water:         255,
  calcium:       301,
  iron:          303,
  potassium:     306,
  sodium:        307,
  vit_a:         320,
  vit_e:         323,
  vit_d:         324,
  vit_c:         401,
  zinc:          309,
  // kcal contributions (Cronometer-specific)
  protein_kcal:  -203,
  carb_kcal:     -204,
  fat_kcal:      -205,
  alcohol_kcal:  -221,
};

/**
 * Build a nutrient object from named values.
 * Any unrecognized keys in `values` are silently ignored.
 * Missing known nutrients default to 0.
 *
 * @param {Object} values  - e.g. { energy: 150, protein: 25, fat: 4, carbs: 4 }
 * @returns {Object}  nutrientId (number) → value (number)
 */
export function makeNutrientMap(values = {}) {
  const result = {};
  // Compute kcal contributions from macros if not explicitly provided
  const p  = values.protein ?? 0;
  const f  = values.fat     ?? 0;
  const c  = values.carbs   ?? 0;
  const derived = {
    protein_kcal: values.protein_kcal ?? p * 4,
    fat_kcal:     values.fat_kcal     ?? f * 9,
    carb_kcal:    values.carb_kcal    ?? c * 4,
    alcohol_kcal: values.alcohol_kcal ?? 0,
  };
  const all = { ...values, ...derived };
  for (const [key, id] of Object.entries(NUTRIENT_ID)) {
    result[id] = all[key] ?? 0;
  }
  // Also include any raw numeric-ID overrides the caller passed in
  for (const [k, v] of Object.entries(values)) {
    if (!isNaN(Number(k))) result[Number(k)] = v;
  }
  return result;
}

// ── Recipe payload builder ────────────────────────────────────────────────────

/**
 * Build an addFood (create) or editFood (update) GWT-RPC payload.
 *
 * @param {Object} opts
 * @param {string}  opts.method        - 'addFood' | 'editFood'
 * @param {string}  opts.session       - GWT session token (= CRONOMETER_SESSION_TOKEN)
 * @param {number}  opts.userId        - Cronometer user ID
 * @param {string}  opts.name          - Food/recipe name
 * @param {number}  opts.foodId        - 0 for new, existing ID for edit
 * @param {number}  opts.primaryMeasureId - 0 for new, existing measure ID for edit
 * @param {string}  opts.servingName   - Label for the primary serving, e.g. 'full recipe'
 * @param {number}  opts.servingGrams  - Grams per primary serving
 * @param {Array}   opts.ingredients   - [{foodId, measureId, grams, ingredientId?}]
 *                                       ingredientId omit/null for new ingredients
 * @param {Object}  opts.nutrients     - nutrientId (number) → value (number)
 * @param {string}  opts.note          - Optional note string (default '')
 * @param {number}  opts.foodType      - 0=custom, 1=recipe (default 1)
 */
export function buildFoodPayload({
  method,
  session,
  userId,
  name,
  foodId = 0,
  primaryMeasureId = 0,
  servingName = 'full recipe',
  servingGrams = 100,
  ingredients = [],
  nutrients = {},
  note = '',
  foodType = 1,
}) {
  const isCreate = method === 'addFood';

  // ── String table ─────────────────────────────────────────────────
  // Order must match HAR exactly; variable strings at known positions.
  // For addFood (4 params): includes T_INGR_SUBS at index 8; session at 9.
  // For editFood (3 params): session at 8, T_INGR_SUBS absent.

  let strings, IDX; // IDX = 1-based string table positions for variable fields

  if (isCreate) {
    strings = [
      T_MODULE_BASE,   // 1
      T_TYPE_SIG,      // 2
      T_SERVICE,       // 3
      'addFood',       // 4
      T_STRING_TYPE,   // 5
      T_INT_TYPE,      // 6
      T_FOOD,          // 7
      T_INGR_SUBS,     // 8
      session,         // 9  ← variable
      T_ARRAYLIST,     // 10
      note,            // 11 ← variable
      T_INGREDIENT,    // 12
      T_NUTR_LABEL,    // 13
      T_FOOD_MEAS,     // 14
      T_MEASURE,       // 15
      servingName,     // 16 ← variable
      T_MEAS_TYPE,     // 17
      'Serving',       // 18
      'g',             // 19
      T_NUTRIENT_MAP,  // 20
      T_NUTR_FILTER,   // 21
      T_HASHMAP,       // 22
      T_INTEGER,       // 23
      T_NUTRIENT,      // 24
      T_NUTR_TYPE,     // 25
      'advancedServingSize', // 26
      'false',         // 27
      'Custom',        // 28
      T_HASHSET,       // 29
      T_TRANSLATION,   // 30
      T_LANGUAGE,      // 31
      'en',            // 32
      'English',       // 33
      'https://cdn1.cronometer.com/media/flags/us.png', // 34
      name,            // 35 ← variable
      T_FOOD_TYPE,     // 36
    ];
    IDX = { session: 9, note: 11, servingName: 16, name: 35, ingrClass: 12,
            nutriLabel: 13, foodMeas: 14, measure: 15, measType: 17,
            nutriMap: 20, nutriFilter: 21, hashmap: 22, integer: 23,
            nutrient: 24, nutriType: 25, adv: 26, advVal: 27,
            custom: 28, hashset: 29, translation: 30, lang: 31,
            en: 32, english: 33, flag: 34, foodType: 36 };
  } else {
    // editFood: no T_INGR_SUBS, session at position 8
    strings = [
      T_MODULE_BASE,   // 1
      T_TYPE_SIG,      // 2
      T_SERVICE,       // 3
      'editFood',      // 4
      T_STRING_TYPE,   // 5
      T_INT_TYPE,      // 6
      T_FOOD,          // 7
      session,         // 8  ← variable
      T_ARRAYLIST,     // 9
      note,            // 10 ← variable
      T_INGREDIENT,    // 11
      T_NUTR_LABEL,    // 12
      T_FOOD_MEAS,     // 13
      T_MEASURE,       // 14
      'g',             // 15
      T_MEAS_TYPE,     // 16
      servingName,     // 17 ← variable
      'Serving',       // 18
      T_NUTRIENT_MAP,  // 19
      T_NUTR_FILTER,   // 20
      T_HASHMAP,       // 21
      T_INTEGER,       // 22
      T_NUTRIENT,      // 23
      T_NUTR_TYPE,     // 24
      'advancedServingSize', // 25
      'false',         // 26
      'Custom',        // 27
      T_HASHSET,       // 28
      T_TRANSLATION,   // 29
      T_LANGUAGE,      // 30
      'en',            // 31
      'English',       // 32
      'https://cdn1.cronometer.com/media/flags/us.png', // 33
      name,            // 34 ← variable
      T_FOOD_TYPE,     // 35
    ];
    IDX = { session: 8, note: 10, servingName: 17, name: 34, ingrClass: 11,
            nutriLabel: 12, foodMeas: 13, measure: 14, measType: 16,
            nutriMap: 19, nutriFilter: 20, hashmap: 21, integer: 22,
            nutrient: 23, nutriType: 24, adv: 25, advVal: 26,
            custom: 27, hashset: 28, translation: 29, lang: 30,
            en: 31, english: 32, flag: 33, foodType: 35 };
  }

  // ── Data tokens ───────────────────────────────────────────────────
  const tok = [];

  // RPC envelope
  tok.push(1, 2, 3, 4);

  if (isCreate) {
    tok.push(4, 5, 6, 7, 8);  // 4 params: String, I, Food, IngredientSubstitutions
    tok.push(IDX.session, userId);
  } else {
    tok.push(3, 5, 6, 7);     // 3 params: String, I, Food
    tok.push(IDX.session, userId);
  }

  // Food object
  const AL = isCreate ? 10 : 9;  // ArrayList string index differs by method
  tok.push(7);                    // Food class
  tok.push(0, 0);                 // placeholders (id=0 for new; server fills on create)
  tok.push(AL, 0, 0);             // empty ArrayList (unused substitution list?)
  tok.push(IDX.note);             // note string
  tok.push(0, 0, 0);             // null/zero placeholders for other Food fields

  // Ingredient list
  tok.push(AL, ingredients.length);
  for (const ing of ingredients) {
    const ingId = ing.ingredientId ?? 'A';  // 'A' = new ingredient (no server-side ID yet)
    tok.push(IDX.ingrClass, ing.grams, ing.foodId, ingId, ing.measureId, 0, 0);
  }

  // NutritionLabelType (1 = standard)
  tok.push(IDX.nutriLabel, 1, 'A');

  // FoodMeasures container
  tok.push(IDX.foodMeas, primaryMeasureId);

  // Measures ArrayList: named serving + "Serving" + "g"
  tok.push(AL, 3);

  // Measure 1: named serving (e.g. "full recipe"), type=3 (recipe), grams=1
  tok.push(IDX.measure, 1, 0, foodId, 0, 0, IDX.servingName, IDX.measType, 3, 1);

  // Measure 2: "Serving", grams=1, type backrefs to Measure$Type already seen
  tok.push(IDX.measure, 1, 0, foodId, 0, 0, 18, -10, 1);

  // Measure 3: "g", grams=servingGrams (basis weight per serving)
  tok.push(IDX.measure, 1, 0, foodId, 0, 0, isCreate ? 19 : 15, -10, servingGrams);

  // NutrientMap
  tok.push(IDX.nutriMap, IDX.nutriFilter, 0);

  // Nutrient entries: [integer_type]|{id}|[nutrient_type]|{value}|{id}|-backref|
  const nutrientEntries = Object.entries(nutrients);
  tok.push(IDX.hashmap, nutrientEntries.length);
  let firstNutrient = true;
  for (const [idStr, value] of nutrientEntries) {
    const id = Number(idStr);
    tok.push(IDX.integer, id, IDX.nutrient, value, id);
    if (firstNutrient) {
      tok.push(0);               // Nutrient$Type first occurrence = null/0
      firstNutrient = false;
    } else {
      tok.push(-(ingredients.length + 18)); // back-reference to reuse Nutrient$Type
    }
  }

  // advancedServingSize metadata
  tok.push(IDX.hashmap, 1, 5, IDX.adv, 5, IDX.advVal, 0);

  // FoodType string + empty categories HashSet
  tok.push(IDX.custom, IDX.hashset, 0);

  // Translation (English only)
  tok.push(AL, 1, IDX.translation, IDX.lang, IDX.en, IDX.english, IDX.flag, IDX.english);
  tok.push(IDX.name, 0, IDX.foodType, foodType);

  // userId again (appears in Food serialization) + IngredientSubstitutions=null for addFood
  tok.push(userId);
  if (isCreate) tok.push(0);  // null IngredientSubstitutions

  return buildPayload(strings, tok);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new recipe (or custom food) via GWT addFood.
 *
 * @param {string} session   - GWT session token (CRONOMETER_SESSION_TOKEN)
 * @param {number} userId    - Cronometer user ID
 * @param {Object} food      - { name, ingredients, servingName, servingGrams, nutrients, note, foodType }
 * @returns {string}  Raw //OK response (foodId is the first value)
 */
export async function addFood(session, userId, food) {
  const payload = buildFoodPayload({ method: 'addFood', session, userId, foodId: 0, primaryMeasureId: 0, ...food });
  return gwtPost(payload, 'addFood', session);
}

/**
 * Update an existing recipe (or custom food) via GWT editFood.
 *
 * @param {string} session          - GWT session token (CRONOMETER_SESSION_TOKEN)
 * @param {number} userId           - Cronometer user ID
 * @param {number} foodId           - Existing food ID to update
 * @param {number} primaryMeasureId - Primary measure ID of the existing food
 * @param {Object} food             - { name, ingredients, servingName, servingGrams, nutrients, note }
 * @returns {string}  Raw //OK response
 */
export async function editFood(session, userId, foodId, primaryMeasureId, food) {
  const payload = buildFoodPayload({ method: 'editFood', session, userId, foodId, primaryMeasureId, ...food });
  return gwtPost(payload, 'editFood', session);
}

/**
 * Parse the foodId from a GWT //OK addFood/editFood response.
 * First numeric value in the response is the food ID.
 */
export function parseFoodIdFromResponse(responseText) {
  const match = responseText.match(/^\/\/OK\[(\d+),/);
  if (!match) throw new Error(`Unexpected GWT response: ${responseText.slice(0, 100)}`);
  return Number(match[1]);
}

export { GWT_TYPE_SIG };
