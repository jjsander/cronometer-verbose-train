/**
 * Cronometer mobile REST API client
 * Base: https://mobile.cronometer.com
 *
 * Auth flow:
 *   POST /api/v2/login  →  { userId, token }
 *   All subsequent calls include { userId, token } in JSON body (v2)
 *   or x-crono-session header (v3 DELETE operations)
 *
 * Session tokens are long-lived (days/weeks). We store them in
 * Netlify env vars (CRONOMETER_USER_ID, CRONOMETER_SESSION_TOKEN)
 * and only re-login if we get a 401.
 */

const BASE = 'https://mobile.cronometer.com';

// ── Low-level fetch wrapper ──────────────────────────────────────────────────

async function cronoFetch(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cronometer API error ${res.status}: ${text}`);
  }
  return res.json();
}

async function cronoDelete(path, sessionToken) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'x-crono-session': sessionToken },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cronometer API error ${res.status}: ${text}`);
  }
  return res.status === 204 ? { success: true } : res.json();
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export async function login(username, password) {
  const data = await cronoFetch('/api/v2/login', { username, password });
  console.log('[cronometer-mcp] Login response keys:', JSON.stringify(Object.keys(data)));
  console.log('[cronometer-mcp] Login response:', JSON.stringify(data));
  return { userId: data.userId, token: data.token };
}

// ── Helper: build authed body ─────────────────────────────────────────────────

function auth(userId, token, extra = {}) {
  return { userId, token, ...extra };
}

// ── Food Log ─────────────────────────────────────────────────────────────────

/**
 * Get diary entries for a date.
 * Returns array of { foodName, servingSize, servingUnit, mealName, energy, ... }
 */
export async function getFoodLog(userId, token, date) {
  return cronoFetch('/api/v2/getDiaryDay', auth(userId, token, { date }));
}

/**
 * Add a food entry to the diary.
 * foodId: Cronometer food ID (from searchFoods)
 * measureId: serving size ID
 * quantity: number of servings
 * mealName: 'Breakfast' | 'Lunch' | 'Dinner' | 'Snacks' (or custom)
 * timestamp: ISO 8601 datetime string e.g. '2025-06-14T08:30:00'
 */
export async function addFoodEntry(userId, token, { foodId, measureId, quantity, mealName, timestamp, date }) {
  return cronoFetch('/api/v2/addServing', auth(userId, token, {
    foodId,
    measureId,
    quantity,
    mealName,
    timestamp,
    date,
  }));
}

/**
 * Remove a diary entry.
 * servingId: the id returned in getFoodLog entries
 */
export async function removeFoodEntry(userId, token, servingId) {
  return cronoDelete(`/api/v3/user/${userId}/serving/${servingId}`, token);
}

/**
 * Copy all entries from one day to another.
 */
export async function copyDay(userId, token, fromDate, toDate) {
  return cronoFetch('/api/v2/copyDay', auth(userId, token, { fromDate, toDate }));
}

/**
 * Mark a diary day as complete or incomplete.
 */
export async function markDayComplete(userId, token, date, complete = true) {
  return cronoFetch('/api/v2/setDayComplete', auth(userId, token, { date, complete }));
}

// ── Nutrition ─────────────────────────────────────────────────────────────────

/**
 * Get daily macro/micro totals for a date.
 * Returns nutrients object with consumed, target, unit per nutrient.
 */
export async function getNutritionSummary(userId, token, date) {
  return cronoFetch('/api/v2/getDailySummary', auth(userId, token, { date }));
}

/**
 * Get nutrition scores with per-nutrient confidence grades.
 */
export async function getNutritionScores(userId, token, date) {
  return cronoFetch('/api/v2/getNutritionScores', auth(userId, token, { date }));
}

// ── Food Search ───────────────────────────────────────────────────────────────

/**
 * Search Cronometer food database.
 * Returns array of { foodId, name, brand, measures: [{ measureId, name, grams }] }
 */
export async function searchFoods(userId, token, query, limit = 20) {
  return cronoFetch('/api/v2/searchFoods', auth(userId, token, { query, limit }));
}

/**
 * Get full nutrition details for a specific food.
 */
export async function getFoodDetails(userId, token, foodId) {
  return cronoFetch('/api/v2/getFoodDetails', auth(userId, token, { foodId }));
}

// ── Custom Foods ──────────────────────────────────────────────────────────────

/**
 * Create a custom food.
 * nutrition: object with nutrient keys e.g. { energy: 200, protein: 10, ... }
 */
export async function addCustomFood(userId, token, { name, servingName, servingGrams, nutrition }) {
  return cronoFetch('/api/v2/addCustomFood', auth(userId, token, {
    name,
    servingName,
    servingGrams,
    nutrition,
  }));
}

// ── Macro Targets ─────────────────────────────────────────────────────────────

/**
 * Get current macro targets including weekly schedule and templates.
 */
export async function getMacroTargets(userId, token) {
  return cronoFetch('/api/v2/getMacroTargets', auth(userId, token));
}

// ── Fasting ───────────────────────────────────────────────────────────────────

/**
 * Get fasting history.
 * startDate / endDate: YYYY-MM-DD
 */
export async function getFastingHistory(userId, token, startDate, endDate) {
  return cronoFetch('/api/v2/getFastingHistory', auth(userId, token, { startDate, endDate }));
}

/**
 * Get aggregate fasting statistics.
 */
export async function getFastingStats(userId, token) {
  return cronoFetch('/api/v2/getFastingStats', auth(userId, token));
}
