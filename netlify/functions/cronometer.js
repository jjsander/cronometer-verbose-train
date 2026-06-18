/**
 * Cronometer GWT-RPC API client (JavaScript port of cphoskins/cronometer-mcp)
 *
 * Auth flow:
 *   1. GET /login/ → scrape anticsrf token
 *   2. POST /login  with credentials + anticsrf → session cookie (sesnonce)
 *   3. POST /cronometer/app GWT authenticate → userId + updated nonce
 *   4. All subsequent GWT calls use session cookie + nonce
 *
 * GWT values auto-discovered from live app on login.
 * Fallback defaults included if discovery fails.
 */

const BASE = 'https://cronometer.com';
const GWT_URL = `${BASE}/cronometer/app`;
const GWT_MODULE_BASE = `${BASE}/cronometer/`;
const GWT_NOCACHE_JS_URL = `${BASE}/cronometer/cronometer.nocache.js`;
const GWT_CACHE_JS_URL = `${BASE}/cronometer/{permutation}.cache.js`;

// Fallback GWT values — update if auth breaks after a Cronometer deploy
const DEFAULT_GWT_PERMUTATION = 'F25561B47C31168F0ED80B768B647985';
const DEFAULT_GWT_HEADER      = 'F25561B47C31168F0ED80B768B647985';
const GWT_CONTENT_TYPE        = 'text/x-gwt-rpc; charset=UTF-8';

// GWT RPC templates (ported from Python client)
const GWT_AUTHENTICATE = (h) =>
  `7|0|5|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|authenticate|java.lang.Integer/3438268394|1|2|3|4|1|5|5|-300|`;

const GWT_GENERATE_AUTH_TOKEN = (h, nonce, userId) =>
  `7|0|8|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|generateAuthorizationToken|java.lang.String/2004016611|I|com.cronometer.shared.user.AuthScope/2065601159|${nonce}|1|2|3|4|4|5|6|6|7|8|${userId}|3600|7|2|`;

const GWT_FIND_FOODS = (h, nonce, query, maxResults) =>
  `7|0|12|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|findFoods|java.lang.String/2004016611|I|[Lcom.cronometer.shared.foods.FoodSource;/3597302983|com.cronometer.shared.foods.FoodSearchTabSelection/1776179901|Z|${nonce}|${query}|com.cronometer.shared.foods.FoodSource/4236433762|1|2|3|4|8|5|5|6|7|6|5|8|9|10|11|${maxResults}|7|1|12|0|0|0|8|0|0|`;

const GWT_UPDATE_DIARY = (h, nonce, userId, day, month, year, quantity, diaryGroup, measureId, weightGrams, foodSourceId, foodId) =>
  `7|0|12|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|updateDiary|java.lang.String/2004016611|I|java.util.List|${nonce}|java.util.Collections$SingletonList/1586180994|com.cronometer.shared.entries.changes.AddEntryChange/3949104564|com.cronometer.shared.entries.models.Serving/2553599101|com.cronometer.shared.entries.models.Day/782579793|1|2|3|4|3|5|6|7|8|${userId}|9|10|1|1|11|12|${day}|${month}|${year}|${quantity}|${diaryGroup}|0|${measureId}|0|0|${weightGrams}|${foodSourceId}|A|${foodId}|0|1|`;

const GWT_REMOVE_SERVING = (h, nonce, userId, servingId) =>
  `7|0|8|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|removeServing|java.lang.String/2004016611|J|I|${nonce}|1|2|3|4|3|5|6|7|8|${servingId}|${userId}|`;

const GWT_GET_FOOD = (h, nonce, foodSourceId) =>
  `7|0|7|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|getFood|java.lang.String/2004016611|I|${nonce}|1|2|3|4|2|5|6|7|${foodSourceId}|`;

const GWT_COPY_DAY = (h, nonce, userId, srcDay, srcMonth, srcYear, dstDay, dstMonth, dstYear) =>
  `7|0|8|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|copyDay|java.lang.String/2004016611|I|com.cronometer.shared.entries.models.Day/782579793|${nonce}|1|2|3|4|4|5|6|7|7|8|${userId}|7|${srcDay}|${srcMonth}|${srcYear}|7|${dstDay}|${dstMonth}|${dstYear}|`;

const GWT_SET_DAY_COMPLETE = (h, nonce, userId, day, month, year, complete) =>
  `7|0|9|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|setDayComplete|java.lang.String/2004016611|I|com.cronometer.shared.entries.models.Day/782579793|java.lang.Boolean/476441737|${nonce}|1|2|3|4|4|5|6|7|8|9|${userId}|7|${day}|${month}|${year}|${complete}|`;

const GWT_GET_MACRO_TARGETS = (h, nonce, userId) =>
  `7|0|7|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|getAllMacroSchedules|java.lang.String/2004016611|I|${nonce}|1|2|3|4|2|5|6|7|${userId}|`;

const GWT_GET_USER_FASTS = (h, nonce, userId) =>
  `7|0|7|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|getUserFasts|java.lang.String/2004016611|I|${nonce}|1|2|3|4|2|5|6|7|${userId}|`;

const GWT_GET_FASTING_STATS = (h, nonce, userId) =>
  `7|0|7|${GWT_MODULE_BASE}|${h}|com.cronometer.shared.rpc.CronometerService|getFastingStats|java.lang.String/2004016611|I|${nonce}|1|2|3|4|2|5|6|7|${userId}|`;

// Universal measure ID that works for any food (from cphoskins/cronometer-mcp)
const UNIVERSAL_MEASURE_ID = 124399;

// ── Cookie utilities ──────────────────────────────────────────────────────────

function parseCookies(setCookieHeaders) {
  const cookies = {};
  for (const header of setCookieHeaders) {
    const part = header.split(';')[0].trim();
    const idx = part.indexOf('=');
    if (idx > 0) {
      cookies[part.slice(0, idx)] = part.slice(idx + 1);
    }
  }
  return cookies;
}

function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function getSetCookies(res) {
  if (res.headers.getSetCookie) return res.headers.getSetCookie();
  const val = res.headers.get('set-cookie');
  return val ? [val] : [];
}

// ── GWT hash discovery ────────────────────────────────────────────────────────

async function discoverGwtHashes(cookies) {
  try {
    const res = await fetch(GWT_NOCACHE_JS_URL, {
      headers: { 'Cookie': cookieHeader(cookies), 'User-Agent': 'cronometer-mcp/1.0' },
    });
    const js = await res.text();
    const permMatch = js.match(/='([A-F0-9]{32})'/);
    if (!permMatch) throw new Error('No permutation found');
    const permutation = permMatch[1];

    const cacheUrl = GWT_CACHE_JS_URL.replace('{permutation}', permutation);
    const cacheRes = await fetch(cacheUrl, {
      headers: { 'Cookie': cookieHeader(cookies), 'User-Agent': 'cronometer-mcp/1.0' },
    });
    const cacheJs = await cacheRes.text();
    const headerMatch = cacheJs.match(/'app','([A-F0-9]{32})'/);
    const gwtHeader = headerMatch ? headerMatch[1] : permutation;

    console.log(`[cronometer-mcp] GWT discovered: permutation=${permutation}, header=${gwtHeader}`);
    return { permutation, gwtHeader };
  } catch (e) {
    console.log(`[cronometer-mcp] GWT discovery failed (${e.message}), using defaults`);
    return { permutation: DEFAULT_GWT_PERMUTATION, gwtHeader: DEFAULT_GWT_HEADER };
  }
}

// ── GWT POST helper ───────────────────────────────────────────────────────────

async function gwtPost(body, cookies, permutation) {
  const res = await fetch(GWT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': GWT_CONTENT_TYPE,
      'Cookie': cookieHeader(cookies),
      'X-GWT-Module-Base': GWT_MODULE_BASE,
      'X-GWT-Permutation': permutation,
      'User-Agent': 'cronometer-mcp/1.0',
      'Referer': `${BASE}/`,
    },
    body,
  });
  const text = await res.text();
  if (!text.startsWith('//OK')) {
    throw new Error(`GWT call failed: ${text.slice(0, 300)}`);
  }
  return text;
}

// ── Login ─────────────────────────────────────────────────────────────────────

export async function login(username, password) {
  // Step 1: get anticsrf token
  const loginPageRes = await fetch(`${BASE}/login/`, {
    headers: { 'User-Agent': 'cronometer-mcp/1.0', 'Accept': 'text/html' },
  });
  const html = await loginPageRes.text();
  const csrfMatch = html.match(/name="anticsrf"\s+value="([^"]+)"/) ||
                    html.match(/value="([^"]+)"\s+name="anticsrf"/);
  if (!csrfMatch) throw new Error('Could not find anticsrf token on login page');
  const anticsrf = csrfMatch[1];
  const initCookies = parseCookies(getSetCookies(loginPageRes));

  // Step 2: POST credentials
  const loginBody = new URLSearchParams({ anticsrf, username, password });
  const loginRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookieHeader(initCookies),
      'User-Agent': 'cronometer-mcp/1.0',
      'Referer': `${BASE}/login/`,
    },
    body: loginBody.toString(),
    redirect: 'manual',
  });

  const loginSetCookies = getSetCookies(loginRes);
  const sessionCookies = { ...initCookies, ...parseCookies(loginSetCookies) };

  if (!sessionCookies.sesnonce) {
    // Try following redirect
    const loginResText = await loginRes.text().catch(() => '');
    console.log('[cronometer-mcp] Login response status:', loginRes.status, loginResText.slice(0, 200));
    throw new Error('Login failed: no sesnonce cookie received. Check credentials.');
  }

  // Step 3: Discover GWT hashes
  const { permutation, gwtHeader } = await discoverGwtHashes(sessionCookies);

  // Step 4: GWT authenticate → userId
  const authBody = GWT_AUTHENTICATE(gwtHeader);
  const authRes = await fetch(GWT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': GWT_CONTENT_TYPE,
      'Cookie': cookieHeader(sessionCookies),
      'X-GWT-Module-Base': GWT_MODULE_BASE,
      'X-GWT-Permutation': permutation,
      'User-Agent': 'cronometer-mcp/1.0',
      'Referer': `${BASE}/`,
    },
    body: authBody,
  });
  const authText = await authRes.text();
  const userIdMatch = authText.match(/\/\/OK\[(\d+)/);
  if (!userIdMatch) throw new Error(`GWT authenticate failed: ${authText.slice(0, 200)}`);
  const userId = userIdMatch[1];

  // Update nonce from authenticate response cookies
  const authCookies = parseCookies(getSetCookies(authRes));
  const finalCookies = { ...sessionCookies, ...authCookies };
  const nonce = finalCookies.sesnonce || sessionCookies.sesnonce;

  console.log(`[cronometer-mcp] LOGIN SUCCESS — userId=${userId}`);
  console.log(`[cronometer-mcp] Cache these env vars:`);
  console.log(`  CRONOMETER_USER_ID=${userId}`);
  console.log(`  CRONOMETER_SESSION_TOKEN=${nonce}`);
  console.log(`  CRONOMETER_GWT_PERMUTATION=${permutation}`);
  console.log(`  CRONOMETER_GWT_HEADER=${gwtHeader}`);

  return { userId, token: nonce, cookies: finalCookies, permutation, gwtHeader };
}

// ── Session management ────────────────────────────────────────────────────────

export async function getSession() {
  const userId     = process.env.CRONOMETER_USER_ID;
  const token      = process.env.CRONOMETER_SESSION_TOKEN;
  const permutation = process.env.CRONOMETER_GWT_PERMUTATION || DEFAULT_GWT_PERMUTATION;
  const gwtHeader  = process.env.CRONOMETER_GWT_HEADER || DEFAULT_GWT_HEADER;

  if (userId && token) {
    return {
      userId,
      token,
      cookies: { sesnonce: token },
      permutation,
      gwtHeader,
    };
  }

  console.log('[cronometer-mcp] No cached session, logging in...');
  return login(
    process.env.CRONOMETER_USERNAME,
    process.env.CRONOMETER_PASSWORD,
  );
}

// ── Export helper (for food log and nutrition summary reads) ──────────────────

async function exportCsv(userId, token, cookies, permutation, gwtHeader, exportType, date) {
  // Generate an auth token for export
  const genBody = GWT_GENERATE_AUTH_TOKEN(gwtHeader, token, userId);
  const genText = await gwtPost(genBody, cookies, permutation);
  const tokenMatch = genText.match(/"([^"]+)"/);
  if (!tokenMatch) throw new Error(`Could not extract export token: ${genText.slice(0, 200)}`);
  const exportToken = tokenMatch[1];

  const url = `${BASE}/export?nonce=${exportToken}&generate=${exportType}&start=${date}&end=${date}`;
  const res = await fetch(url, {
    headers: {
      'Cookie': cookieHeader(cookies),
      'User-Agent': 'cronometer-mcp/1.0',
      'Referer': `${BASE}/`,
    },
  });
  if (!res.ok) throw new Error(`Export request failed: ${res.status}`);
  return res.text();
}

function parseCsvToObjects(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^,]+)(?=,|$)/g) || [];
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] || '').trim().replace(/^"|"$/g, '');
    });
    return obj;
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getFoodLog(userId, token, date) {
  const { cookies, permutation, gwtHeader } = await getSession();
  const csv = await exportCsv(userId, token, cookies, permutation, gwtHeader, 'servings', date);
  const rows = parseCsvToObjects(csv);
  return {
    date,
    foods: rows.map(r => ({
      name: r['Food Name'] || r['name'] || '',
      meal: r['Group'] || r['group'] || '',
      amount: r['Amount'] || r['amount'] || '',
      energy: r['Energy (kcal)'] || r['energy'] || '',
      protein: r['Protein (g)'] || '',
      carbs: r['Carbs (g)'] || r['Net Carbs (g)'] || '',
      fat: r['Fat (g)'] || '',
    })),
  };
}

export async function addFoodEntry(userId, token, { foodId, measureId, quantity, mealName, timestamp, date }) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;

  // Parse date
  const d = new Date(date || new Date().toISOString().slice(0, 10));
  const day = d.getUTCDate(), month = d.getUTCMonth() + 1, year = d.getUTCFullYear();

  // Map mealName to diary group int
  const mealGroups = { breakfast: 1, lunch: 2, dinner: 3, snacks: 4 };
  const diaryGroup = mealGroups[(mealName || 'snacks').toLowerCase()] || 4;

  // Use universal measure ID with quantity as weight in grams
  const effectiveMeasureId = measureId || UNIVERSAL_MEASURE_ID;
  // Encode diary group into high 16 bits of measure ID (as per Python client)
  const encodedMeasureId = (diaryGroup << 16) | (effectiveMeasureId & 0xFFFF);
  const weightGrams = Math.round(quantity * 100) / 100;

  const body = GWT_UPDATE_DIARY(
    gwtHeader, session.token, session.userId,
    day, month, year,
    quantity, diaryGroup, encodedMeasureId,
    weightGrams, foodId, foodId  // foodSourceId = foodId as fallback
  );

  const raw = await gwtPost(body, cookies, permutation);
  const servingMatch = raw.match(/\/\/OK\[\d+,\d+,\d+,"([^"]+)"/);
  return {
    success: true,
    servingId: servingMatch ? servingMatch[1] : '',
    raw: raw.slice(0, 200),
  };
}

export async function removeFoodEntry(userId, token, servingId) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const body = GWT_REMOVE_SERVING(gwtHeader, session.token, session.userId, servingId);
  await gwtPost(body, cookies, permutation);
  return { success: true };
}

export async function searchFoods(userId, token, query, limit = 20) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const body = GWT_FIND_FOODS(gwtHeader, session.token, query.toUpperCase(), limit);
  const raw = await gwtPost(body, cookies, permutation);
  return { raw: raw.slice(0, 500), note: 'GWT findFoods response — parse with _parse_find_foods logic if needed' };
}

export async function getFoodDetails(userId, token, foodId) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const body = GWT_GET_FOOD(gwtHeader, session.token, foodId);
  const raw = await gwtPost(body, cookies, permutation);
  return { foodId, raw: raw.slice(0, 500) };
}

export async function getNutritionSummary(userId, token, date) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const csv = await exportCsv(userId, token, cookies, permutation, gwtHeader, 'dailySummary', date);
  const rows = parseCsvToObjects(csv);
  return { date, summary: rows[0] || {} };
}

export async function getNutritionScores(userId, token, date) {
  return getNutritionSummary(userId, token, date);
}

export async function copyDay(userId, token, fromDate, toDate) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const src = new Date(fromDate), dst = new Date(toDate);
  const body = GWT_COPY_DAY(
    gwtHeader, session.token, session.userId,
    src.getUTCDate(), src.getUTCMonth() + 1, src.getUTCFullYear(),
    dst.getUTCDate(), dst.getUTCMonth() + 1, dst.getUTCFullYear(),
  );
  await gwtPost(body, cookies, permutation);
  return { success: true };
}

export async function markDayComplete(userId, token, date, complete = true) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const d = new Date(date);
  const body = GWT_SET_DAY_COMPLETE(
    gwtHeader, session.token, session.userId,
    d.getUTCDate(), d.getUTCMonth() + 1, d.getUTCFullYear(),
    complete ? 1 : 0,
  );
  await gwtPost(body, cookies, permutation);
  return { success: true };
}

export async function getMacroTargets(userId, token) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const body = GWT_GET_MACRO_TARGETS(gwtHeader, session.token, session.userId);
  const raw = await gwtPost(body, cookies, permutation);
  return { raw: raw.slice(0, 500) };
}

export async function getFastingHistory(userId, token, startDate, endDate) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const body = GWT_GET_USER_FASTS(gwtHeader, session.token, session.userId);
  const raw = await gwtPost(body, cookies, permutation);
  return { raw: raw.slice(0, 500) };
}

export async function getFastingStats(userId, token) {
  const session = await getSession();
  const { cookies, permutation, gwtHeader } = session;
  const body = GWT_GET_FASTING_STATS(gwtHeader, session.token, session.userId);
  const raw = await gwtPost(body, cookies, permutation);
  return { raw: raw.slice(0, 500) };
}

export async function addCustomFood(userId, token, { name, servingName, servingGrams, nutrition }) {
  throw new Error('addCustomFood not yet implemented in GWT client. Use Cronometer app to create custom foods.');
}
