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

function loadStore() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = {
      logs: [],
      customFoods: [],
      weightLogs: [],
      goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
      settings: { weightUnit: 'lbs' },
    };
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  // backfill fields for stores created before weight tracking existed
  if (!store.weightLogs) store.weightLogs = [];
  if (!store.settings) store.settings = { weightUnit: 'lbs' };
  return store;
}

function saveStore(store) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

function round1(n) {
  return Math.round(n * 10) / 10;
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

// ---------- daily log ----------

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

app.post('/api/log', (req, res) => {
  const { date, description, quantity, unit, calories, protein, carbs, fat, source } =
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

// ---------- body weight ----------

app.get('/api/weight', (req, res) => {
  const store = loadStore();
  const weightLogs = [...store.weightLogs].sort((a, b) => a.date.localeCompare(b.date));
  res.json({ weightLogs, unit: store.settings.weightUnit });
});

app.post('/api/weight', (req, res) => {
  const { date, weight, unit } = req.body || {};
  if (!date || weight === undefined || weight === null || weight === '') {
    return res.status(400).json({ error: 'date and weight are required' });
  }
  const w = round1(Number(weight));
  if (!Number.isFinite(w) || w <= 0) {
    return res.status(400).json({ error: 'weight must be a positive number' });
  }
  const store = loadStore();
  const useUnit = unit || store.settings.weightUnit || 'lbs';
  store.settings.weightUnit = useUnit;

  // one entry per date - logging again for the same day updates it
  const existing = store.weightLogs.find((l) => l.date === date);
  if (existing) {
    existing.weight = w;
    existing.unit = useUnit;
    existing.loggedAt = new Date().toISOString();
    saveStore(store);
    return res.json(existing);
  }

  const entry = {
    id: crypto.randomUUID(),
    date,
    weight: w,
    unit: useUnit,
    loggedAt: new Date().toISOString(),
  };
  store.weightLogs.push(entry);
  saveStore(store);
  res.json(entry);
});

app.delete('/api/weight/:id', (req, res) => {
  const store = loadStore();
  store.weightLogs = store.weightLogs.filter((l) => l.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true });
});

// ---------- goals ----------

app.get('/api/goals', (req, res) => {
  res.json(loadStore().goals);
});

app.post('/api/goals', (req, res) => {
  const store = loadStore();
  const { calories, protein, carbs, fat } = req.body || {};
  store.goals = {
    calories: Number(calories) || store.goals.calories,
    protein: Number(protein) || store.goals.protein,
    carbs: Number(carbs) || store.goals.carbs,
    fat: Number(fat) || store.goals.fat,
  };
  saveStore(store);
  res.json(store.goals);
});

app.listen(PORT, () => {
  console.log(`Macro tracker running at http://localhost:${PORT}`);
  if (USDA_API_KEY === 'DEMO_KEY') {
    console.log('Using DEMO_KEY for USDA API - get your own free key at https://fdc.nal.usda.gov/api-key-signup');
  }
});
