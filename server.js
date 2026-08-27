require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const USDA_API_KEY = process.env.USDA_API_KEY || 'DEMO_KEY';
const DATA_FILE = path.join(__dirname, 'data', 'store.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- tiny JSON-file "database" ----------

function defaultGoals() {
  return { calories: 2000, protein: 150, carbs: 200, fat: 65, steps: 10000 };
}

function defaultSettings() {
  return { weightUnit: 'lbs', targetWeight: null };
}

function loadStore() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      logs: [],
      customFoods: [],
      meals: [],
      bodyLogs: [],
      stepLogs: [],
      workouts: [],
      goals: defaultGoals(),
      settings: defaultSettings(),
    };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  let changed = false;

  if (!store.logs) { store.logs = []; changed = true; }
  if (!store.customFoods) { store.customFoods = []; changed = true; }
  if (!store.meals) { store.meals = []; changed = true; }
  if (!store.workouts) { store.workouts = []; changed = true; }
  if (!store.goals) { store.goals = defaultGoals(); changed = true; }
  if (store.goals.steps === undefined) { store.goals.steps = 10000; changed = true; }
  if (!store.settings) { store.settings = defaultSettings(); changed = true; }
  if (store.settings.targetWeight === undefined) { store.settings.targetWeight = null; changed = true; }

  // migrate legacy combined weightLogs (weight+steps per date) into separate bodyLogs + stepLogs
  if (!store.bodyLogs) store.bodyLogs = [];
  if (!store.stepLogs) store.stepLogs = [];
  if (Array.isArray(store.weightLogs)) {
    for (const entry of store.weightLogs) {
      if (entry.weight !== undefined && entry.weight !== null) {
        store.bodyLogs.push({
          id: entry.id || crypto.randomUUID(),
          date: entry.date,
          weight: entry.weight,
          unit: entry.unit || store.settings.weightUnit || 'lbs',
          bodyFatPct: null,
          waist: null,
          loggedAt: entry.loggedAt || new Date().toISOString(),
        });
      }
      if (entry.steps !== undefined && entry.steps !== null) {
        store.stepLogs.push({
          id: crypto.randomUUID(),
          date: entry.date,
          steps: entry.steps,
          loggedAt: entry.loggedAt || new Date().toISOString(),
        });
      }
    }
    delete store.weightLogs;
    changed = true;
  }

  if (changed) saveStore(store);
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDateStr(d) {
  return d.toISOString().slice(0, 10);
}

// ---------- USDA nutrient parsing ----------
// Standard USDA nutrient numbers: Energy=208, Protein=203, Carbs=205, Fat=204

const NUTRIENT_NUMBER_MAP = {
  '208': 'calories',
  '203': 'protein',
  '205': 'carbs',
  '204': 'fat',
};

function extractMacrosPer100g(food) {
  const macros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const nutrients = food.foodNutrients || [];
  for (const n of nutrients) {
    // /foods/search shape: { nutrientNumber, value, ... }
    let number = n.nutrientNumber;
    let value = n.value;
    // /food/:id detail shape: { nutrient: { number, name, unitName }, amount }
    if (number === undefined && n.nutrient) {
      number = n.nutrient.number;
      value = n.amount;
    }
    if (number !== undefined && NUTRIENT_NUMBER_MAP[number] && typeof value === 'number') {
      macros[NUTRIENT_NUMBER_MAP[number]] = value;
    }
  }
  return macros;
}

function summarizeFood(f) {
  return {
    fdcId: f.fdcId,
    description: f.description,
    brandOwner: f.brandOwner || null,
    dataType: f.dataType,
    servingHint:
      f.householdServingFullText ||
      (f.servingSize ? `${f.servingSize}${f.servingSizeUnit || ''}` : null),
    per100g: extractMacrosPer100g(f),
  };
}

// ---------- USDA proxy endpoints ----------

app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Missing query param q' });
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(
      USDA_API_KEY
    )}&query=${encodeURIComponent(q)}&pageSize=20`;
    const r = await fetch(url);
    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: 'USDA API error', detail });
    }
    const data = await r.json();
    const results = (data.foods || []).map(summarizeFood);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/food/:fdcId', async (req, res) => {
  try {
    const url = `https://api.nal.usda.gov/fdc/v1/food/${encodeURIComponent(
      req.params.fdcId
    )}?api_key=${encodeURIComponent(USDA_API_KEY)}`;
    const r = await fetch(url);
    if (!r.ok) {
      const detail = await r.text();
      return res.status(r.status).json({ error: 'USDA API error', detail });
    }
    const data = await r.json();
    res.json(summarizeFood(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- custom (reusable, hand-entered) foods ----------

app.get('/api/custom-foods', (req, res) => {
  res.json({ customFoods: loadStore().customFoods });
});

app.post('/api/custom-foods', (req, res) => {
  const { name, servingLabel, calories, protein, carbs, fat } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const store = loadStore();
  const food = {
    id: crypto.randomUUID(),
    name,
    servingLabel: servingLabel || '1 serving',
    calories: Math.round(Number(calories) || 0),
    protein: round1(Number(protein) || 0),
    carbs: round1(Number(carbs) || 0),
    fat: round1(Number(fat) || 0),
  };
  store.customFoods.push(food);
  saveStore(store);
  res.json(food);
});

app.delete('/api/custom-foods/:id', (req, res) => {
  const store = loadStore();
  store.customFoods = store.customFoods.filter((f) => f.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true });
});

// ---------- reusable meals (multiple food items saved together) ----------

app.get('/api/meals', (req, res) => {
  res.json({ meals: loadStore().meals });
});

app.post('/api/meals', (req, res) => {
  const { name, items } = req.body || {};
  if (!name || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'name and at least one item are required' });
  }
  const cleanItems = items.map((it) => ({
    description: it.description || 'Item',
    quantity: Number(it.quantity) || 1,
    unit: it.unit || 'serving',
    calories: Math.round(Number(it.calories) || 0),
    protein: round1(Number(it.protein) || 0),
    carbs: round1(Number(it.carbs) || 0),
    fat: round1(Number(it.fat) || 0),
  }));
  const rawTotals = cleanItems.reduce(
    (acc, it) => {
      acc.calories += it.calories;
      acc.protein += it.protein;
      acc.carbs += it.carbs;
      acc.fat += it.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const store = loadStore();
  const meal = {
    id: crypto.randomUUID(),
    name,
    items: cleanItems,
    totals: {
      calories: Math.round(rawTotals.calories),
      protein: round1(rawTotals.protein),
      carbs: round1(rawTotals.carbs),
      fat: round1(rawTotals.fat),
    },
  };
  store.meals.push(meal);
  saveStore(store);
  res.json(meal);
});

app.delete('/api/meals/:id', (req, res) => {
  const store = loadStore();
  store.meals = store.meals.filter((m) => m.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true });
});

app.post('/api/meals/:id/log', (req, res) => {
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });
  const store = loadStore();
  const meal = store.meals.find((m) => m.id === req.params.id);
  if (!meal) return res.status(404).json({ error: 'meal not found' });
  const loggedAt = new Date().toISOString();
  const entries = meal.items.map((it) => ({
    id: crypto.randomUUID(),
    date,
    description: it.description,
    quantity: it.quantity,
    unit: it.unit,
    calories: it.calories,
    protein: it.protein,
    carbs: it.carbs,
    fat: it.fat,
    source: 'meal',
    mealId: meal.id,
    mealName: meal.name,
    loggedAt,
  }));
  store.logs.push(...entries);
  saveStore(store);
  res.json({ entries, totals: meal.totals });
});

// ---------- daily food log ----------

app.get('/api/log', (req, res) => {
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date query param is required (YYYY-MM-DD)' });
  const store = loadStore();
  const entries = store.logs
    .filter((l) => l.date === date)
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  const totals = entries.reduce(
    (acc, e) => {
      acc.calories += e.calories;
      acc.protein += e.protein;
      acc.carbs += e.carbs;
      acc.fat += e.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  totals.calories = Math.round(totals.calories);
  totals.protein = round1(totals.protein);
  totals.carbs = round1(totals.carbs);
  totals.fat = round1(totals.fat);
  res.json({ entries, totals, goals: store.goals });
});

// aggregate totals for a date range, used for trend charts
app.get('/api/log/range', (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start and end query params are required' });
  const store = loadStore();

  const days = [];
  let cursor = parseDateStr(start);
  const endDate = parseDateStr(end);
  if (isNaN(cursor) || isNaN(endDate)) return res.status(400).json({ error: 'invalid date' });
  // cap range to avoid runaway loops
  let guard = 0;
  while (cursor <= endDate && guard < 366) {
    days.push(formatDateStr(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }

  const byDate = {};
  for (const day of days) byDate[day] = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const l of store.logs) {
    if (byDate[l.date]) {
      byDate[l.date].calories += l.calories;
      byDate[l.date].protein += l.protein;
      byDate[l.date].carbs += l.carbs;
      byDate[l.date].fat += l.fat;
    }
  }

  const result = days.map((date) => ({
    date,
    calories: Math.round(byDate[date].calories),
    protein: round1(byDate[date].protein),
    carbs: round1(byDate[date].carbs),
    fat: round1(byDate[date].fat),
  }));

  res.json({ days: result, goals: store.goals });
});

// distinct recently-logged items, for one-tap re-logging
app.get('/api/log/recent', (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const store = loadStore();
  const sorted = [...store.logs].sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
  const seen = new Set();
  const recent = [];
  for (const l of sorted) {
    const key = l.description.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recent.push(l);
    if (recent.length >= limit) break;
  }
  res.json({ recent });
});

// duplicate an entire day's log entries onto another date
app.post('/api/log/copy-day', (req, res) => {
  const { fromDate, toDate } = req.body || {};
  if (!fromDate || !toDate) return res.status(400).json({ error: 'fromDate and toDate are required' });
  const store = loadStore();
  const source = store.logs.filter((l) => l.date === fromDate);
  if (!source.length) return res.status(404).json({ error: `No entries found on ${fromDate}` });
  const loggedAt = new Date().toISOString();
  const copies = source.map((l) => ({
    ...l,
    id: crypto.randomUUID(),
    date: toDate,
    loggedAt,
  }));
  store.logs.push(...copies);
  saveStore(store);
  res.json({ entries: copies });
});

app.post('/api/log', (req, res) => {
  const { date, description, quantity, unit, calories, protein, carbs, fat, source, mealId, mealName } =
    req.body || {};
  if (!date || !description) {
    return res.status(400).json({ error: 'date and description are required' });
  }
  const store = loadStore();
  const entry = {
    id: crypto.randomUUID(),
    date,
    description,
    quantity: Number(quantity) || 1,
    unit: unit || 'serving',
    calories: Math.round(Number(calories) || 0),
    protein: round1(Number(protein) || 0),
    carbs: round1(Number(carbs) || 0),
    fat: round1(Number(fat) || 0),
    source: source || 'manual',
    mealId: mealId || null,
    mealName: mealName || null,
    loggedAt: new Date().toISOString(),
  };
  store.logs.push(entry);
  saveStore(store);
  res.json(entry);
});

app.delete('/api/log/:id', (req, res) => {
  const store = loadStore();
  store.logs = store.logs.filter((l) => l.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true });
});

// ---------- physical attributes (weight, body fat %, waist) ----------

app.get('/api/body', (req, res) => {
  const store = loadStore();
  const bodyLogs = [...store.bodyLogs].sort((a, b) => a.date.localeCompare(b.date));
  res.json({ bodyLogs, unit: store.settings.weightUnit, targetWeight: store.settings.targetWeight });
});

app.post('/api/body', (req, res) => {
  const { date, weight, unit, bodyFatPct, waist } = req.body || {};
  if (!date) return res.status(400).json({ error: 'date is required' });

  const hasWeight = weight !== undefined && weight !== null && weight !== '';
  const hasBf = bodyFatPct !== undefined && bodyFatPct !== null && bodyFatPct !== '';
  const hasWaist = waist !== undefined && waist !== null && waist !== '';
  if (!hasWeight && !hasBf && !hasWaist) {
    return res.status(400).json({ error: 'weight, bodyFatPct, or waist is required' });
  }

  let w = null;
  if (hasWeight) {
    w = round1(Number(weight));
    if (!Number.isFinite(w) || w <= 0) return res.status(400).json({ error: 'weight must be a positive number' });
  }
  let bf = null;
  if (hasBf) {
    bf = round1(Number(bodyFatPct));
    if (!Number.isFinite(bf) || bf < 0 || bf > 100) {
      return res.status(400).json({ error: 'body fat % must be between 0 and 100' });
    }
  }
  let ws = null;
  if (hasWaist) {
    ws = round1(Number(waist));
    if (!Number.isFinite(ws) || ws <= 0) return res.status(400).json({ error: 'waist must be a positive number' });
  }

  const store = loadStore();
  const useUnit = unit || store.settings.weightUnit || 'lbs';
  if (hasWeight) store.settings.weightUnit = useUnit;

  const existing = store.bodyLogs.find((l) => l.date === date);
  if (existing) {
    if (hasWeight) {
      existing.weight = w;
      existing.unit = useUnit;
    }
    if (hasBf) existing.bodyFatPct = bf;
    if (hasWaist) existing.waist = ws;
    existing.loggedAt = new Date().toISOString();
    saveStore(store);
    return res.json(existing);
  }

  const entry = {
    id: crypto.randomUUID(),
    date,
    weight: hasWeight ? w : null,
    unit: useUnit,
    bodyFatPct: hasBf ? bf : null,
    waist: hasWaist ? ws : null,
    loggedAt: new Date().toISOString(),
  };
  store.bodyLogs.push(entry);
  saveStore(store);
  res.json(entry);
});

app.delete('/api/body/:id', (req, res) => {
  const store = loadStore();
  store.bodyLogs = store.bodyLogs.filter((l) => l.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true });
});

// ---------- daily step count ----------

app.get('/api/steps', (req, res) => {
  const store = loadStore();
  const stepLogs = [...store.stepLogs].sort((a, b) => a.date.localeCompare(b.date));
  res.json({ stepLogs, goal: store.goals.steps });
});

app.post('/api/steps', (req, res) => {
  const { date, steps } = req.body || {};
  if (!date || steps === undefined || steps === null || steps === '') {
    return res.status(400).json({ error: 'date and steps are required' });
  }
  const s = Math.round(Number(steps));
  if (!Number.isFinite(s) || s < 0) return res.status(400).json({ error: 'steps must be a non-negative number' });
  const store = loadStore();
  const existing = store.stepLogs.find((l) => l.date === date);
  if (existing) {
    existing.steps = s;
    existing.loggedAt = new Date().toISOString();
    saveStore(store);
    return res.json(existing);
  }
  const entry = { id: crypto.randomUUID(), date, steps: s, loggedAt: new Date().toISOString() };
  store.stepLogs.push(entry);
  saveStore(store);
  res.json(entry);
});

app.delete('/api/steps/:id', (req, res) => {
  const store = loadStore();
  store.stepLogs = store.stepLogs.filter((l) => l.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true });
});

// ---------- workouts / exercise (multiple per day allowed) ----------

app.get('/api/workouts', (req, res) => {
  const store = loadStore();
  const date = req.query.date;
  let workouts = [...store.workouts];
  if (date) workouts = workouts.filter((w) => w.date === date);
  workouts.sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  res.json({ workouts });
});

app.post('/api/workouts', (req, res) => {
  const { date, type, category, reps, weightLbs, durationMin, caloriesBurned } = req.body || {};
  if (!date || !type) return res.status(400).json({ error: 'date and type are required' });
  const cat = category === 'cardio' ? 'cardio' : 'strength';
  const store = loadStore();
  const entry = {
    id: crypto.randomUUID(),
    date,
    category: cat,
    type,
    reps: cat === 'strength' ? Math.round(Number(reps) || 0) : null,
    weightLbs: cat === 'strength' ? round1(Number(weightLbs) || 0) : null,
    durationMin: cat === 'cardio' ? Math.round(Number(durationMin) || 0) : null,
    caloriesBurned: Math.round(Number(caloriesBurned) || 0),
    loggedAt: new Date().toISOString(),
  };
  store.workouts.push(entry);
  saveStore(store);
  res.json(entry);
});

app.delete('/api/workouts/:id', (req, res) => {
  const store = loadStore();
  store.workouts = store.workouts.filter((w) => w.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true });
});

// ---------- goals ----------

app.get('/api/goals', (req, res) => {
  res.json(loadStore().goals);
});

app.post('/api/goals', (req, res) => {
  const store = loadStore();
  const { calories, protein, carbs, fat, steps } = req.body || {};
  store.goals = {
    calories: Number(calories) || store.goals.calories,
    protein: Number(protein) || store.goals.protein,
    carbs: Number(carbs) || store.goals.carbs,
    fat: Number(fat) || store.goals.fat,
    steps: Number(steps) || store.goals.steps,
  };
  saveStore(store);
  res.json(store.goals);
});

// ---------- settings (unit preference, target weight) ----------

app.get('/api/settings', (req, res) => {
  res.json(loadStore().settings);
});

app.post('/api/settings', (req, res) => {
  const store = loadStore();
  const { targetWeight, weightUnit } = req.body || {};
  if (targetWeight !== undefined) {
    store.settings.targetWeight = targetWeight === null || targetWeight === '' ? null : round1(Number(targetWeight));
  }
  if (weightUnit) store.settings.weightUnit = weightUnit;
  saveStore(store);
  res.json(store.settings);
});

// ---------- data export / backup ----------

app.get('/api/export', (req, res) => {
  const store = loadStore();
  res.setHeader('Content-Disposition', 'attachment; filename="health-data-export.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(store, null, 2));
});

app.listen(PORT, () => {
  console.log(`Personal Health Webapp running at http://localhost:${PORT}`);
  if (USDA_API_KEY === 'DEMO_KEY') {
    console.log('Using DEMO_KEY for USDA API - get your own free key at https://fdc.nal.usda.gov/api-key-signup');
  }
});
