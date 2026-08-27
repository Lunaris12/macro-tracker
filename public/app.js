const state = {
  date: toDateStr(new Date()),
  goals: { calories: 2000, protein: 150, carbs: 200, fat: 65, steps: 10000 },
  bodyLogs: [],
  stepLogs: [],
  workouts: [],
  weightUnit: 'lbs',
  targetWeight: null,
  mealCart: [],
};

const el = (id) => document.getElementById(id);

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fromDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function pct(val, goal) {
  if (!goal) return 0;
  return Math.max(0, Math.min(100, (val / goal) * 100));
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

function showToast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- nav ----------

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
    btn.classList.add('active');
    el(`view-${btn.dataset.view}`).classList.remove('hidden');
    if (btn.dataset.view === 'home') loadHome();
  });
});

// ---------- date navigation ----------

el('dateInput').addEventListener('change', () => {
  state.date = el('dateInput').value;
  refreshForDate();
});
el('prevDay').addEventListener('click', () => {
  const d = fromDateStr(state.date);
  d.setDate(d.getDate() - 1);
  state.date = toDateStr(d);
  refreshForDate();
});
el('nextDay').addEventListener('click', () => {
  const d = fromDateStr(state.date);
  d.setDate(d.getDate() + 1);
  state.date = toDateStr(d);
  refreshForDate();
});
el('todayBtn').addEventListener('click', () => {
  state.date = toDateStr(new Date());
  refreshForDate();
});

async function refreshForDate() {
  el('dateInput').value = state.date;
  await loadDayMacro();
  await Promise.all([loadBodyData(), loadStepsData(), loadWorkoutsView()]);
  loadRecent();
  if (!el('view-home').classList.contains('hidden')) loadHome();
}

// ================= MACRO TRACKING =================

async function loadDayMacro() {
  try {
    const data = await api(`/api/log?date=${state.date}`);
    state.goals = data.goals;
    renderSummary(data.totals, data.goals);
    renderLog(data.entries);
  } catch (err) {
    showToast('Failed to load day: ' + err.message);
  }
}

function renderSummary(totals, goals) {
  el('caloriesVal').textContent = totals.calories;
  el('caloriesGoal').textContent = goals.calories;
  el('caloriesBar').style.width = pct(totals.calories, goals.calories) + '%';

  el('proteinVal').textContent = totals.protein;
  el('proteinGoal').textContent = goals.protein;
  el('proteinBar').style.width = pct(totals.protein, goals.protein) + '%';

  el('carbsVal').textContent = totals.carbs;
  el('carbsGoal').textContent = goals.carbs;
  el('carbsBar').style.width = pct(totals.carbs, goals.carbs) + '%';

  el('fatVal').textContent = totals.fat;
  el('fatGoal').textContent = goals.fat;
  el('fatBar').style.width = pct(totals.fat, goals.fat) + '%';
}

function renderLog(entries) {
  const body = el('logTableBody');
  body.innerHTML = '';
  el('emptyLogMsg').classList.toggle('hidden', entries.length > 0);
  for (const e of entries) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="log-food-name">${escapeHtml(e.description)}${e.mealName ? `<span class="meal-tag">${escapeHtml(e.mealName)}</span>` : ''}</div>
      </td>
      <td class="log-food-qty">${e.quantity}${e.unit === 'g' ? 'g' : ' x'}</td>
      <td>${e.calories}</td>
      <td>${e.protein}</td>
      <td>${e.carbs}</td>
      <td>${e.fat}</td>
      <td><button class="del-btn" title="Delete" data-id="${e.id}">&times;</button></td>
    `;
    body.appendChild(tr);
  }
  body.querySelectorAll('.del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/log/${btn.dataset.id}`, { method: 'DELETE' });
        await loadDayMacro();
        loadRecent();
        if (!el('view-home').classList.contains('hidden')) loadHome();
      } catch (err) {
        showToast('Failed to delete: ' + err.message);
      }
    });
  });
}

async function logEntry(entry) {
  await api('/api/log', { method: 'POST', body: JSON.stringify({ date: state.date, ...entry }) });
  showToast(`Logged ${entry.description}`);
  await loadDayMacro();
  loadRecent();
  if (!el('view-home').classList.contains('hidden')) loadHome();
}

el('copyYesterdayBtn').addEventListener('click', async () => {
  const prevDate = toDateStr(addDays(fromDateStr(state.date), -1));
  try {
    await api('/api/log/copy-day', {
      method: 'POST',
      body: JSON.stringify({ fromDate: prevDate, toDate: state.date }),
    });
    showToast(`Copied log from ${prevDate}`);
    await loadDayMacro();
    loadRecent();
    if (!el('view-home').classList.contains('hidden')) loadHome();
  } catch (err) {
    showToast('Failed to copy: ' + err.message);
  }
});

// ---------- recently logged (quick re-log) ----------

async function loadRecent() {
  try {
    const data = await api('/api/log/recent?limit=8');
    renderRecentChips(data.recent);
  } catch (err) {
    // non-critical, fail silently
  }
}

function renderRecentChips(recent) {
  const container = el('recentList');
  container.innerHTML = '';
  if (!recent.length) return;
  const label = document.createElement('div');
  label.className = 'hint';
  label.textContent = 'Recently logged — tap to log again:';
  container.appendChild(label);
  const row = document.createElement('div');
  row.className = 'chip-row';
  for (const r of recent) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = r.description;
    chip.title = `${r.calories} cal, ${r.protein}g protein, ${r.carbs}g carbs, ${r.fat}g fat`;
    chip.addEventListener('click', () => {
      logEntry({
        description: r.description,
        quantity: r.quantity,
        unit: r.unit,
        calories: r.calories,
        protein: r.protein,
        carbs: r.carbs,
        fat: r.fat,
        source: r.source,
      });
    });
    row.appendChild(chip);
  }
  container.appendChild(row);
}

// ---------- goals ----------

el('editGoalsBtn').addEventListener('click', () => {
  el('goalCalories').value = state.goals.calories;
  el('goalProtein').value = state.goals.protein;
  el('goalCarbs').value = state.goals.carbs;
  el('goalFat').value = state.goals.fat;
  el('goalsForm').classList.remove('hidden');
});
el('cancelGoalsBtn').addEventListener('click', () => el('goalsForm').classList.add('hidden'));
el('saveGoalsBtn').addEventListener('click', async () => {
  try {
    const goals = await api('/api/goals', {
      method: 'POST',
      body: JSON.stringify({
        calories: Number(el('goalCalories').value),
        protein: Number(el('goalProtein').value),
        carbs: Number(el('goalCarbs').value),
        fat: Number(el('goalFat').value),
      }),
    });
    state.goals = goals;
    el('goalsForm').classList.add('hidden');
    await loadDayMacro();
    if (!el('view-home').classList.contains('hidden')) loadHome();
  } catch (err) {
    showToast('Failed to save goals: ' + err.message);
  }
});

// ---------- tabs ----------

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    btn.classList.add('active');
    el(`tab-${btn.dataset.tab}`).classList.remove('hidden');
    if (btn.dataset.tab === 'myfoods') loadCustomFoods();
    if (btn.dataset.tab === 'meals') {
      loadMeals();
      renderMealCart();
    }
  });
});

// ---------- USDA search ----------

el('searchBtn').addEventListener('click', runSearch);
el('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runSearch();
});

async function runSearch() {
  const q = el('searchInput').value.trim();
  if (!q) return;
  const container = el('searchResults');
  container.innerHTML = '<p class="hint">Searching...</p>';
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    renderSearchResults(data.results);
  } catch (err) {
    container.innerHTML = `<p class="hint">Search failed: ${escapeHtml(err.message)}</p>`;
  }
}

function renderSearchResults(results) {
  const container = el('searchResults');
  container.innerHTML = '';
  if (!results.length) {
    container.innerHTML = '<p class="hint">No results.</p>';
    return;
  }
  for (const food of results) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-item-top">
        <div>
          <div class="result-name">${escapeHtml(food.description)}</div>
          <div class="result-sub">${escapeHtml(food.brandOwner || food.dataType || '')}${food.servingHint ? ' &middot; ' + escapeHtml(food.servingHint) : ''}</div>
        </div>
        <div class="result-macros">${Math.round(food.per100g.calories)} cal / 100g</div>
      </div>
      <div class="result-expand">
        <label>Grams: <input type="number" class="grams-input" value="100" min="1" /></label>
        <button class="primary-btn add-btn">Add</button>
        <div class="result-preview"></div>
      </div>
    `;
    const top = item.querySelector('.result-item-top');
    const expand = item.querySelector('.result-expand');
    const gramsInput = item.querySelector('.grams-input');
    const preview = item.querySelector('.result-preview');
    const addBtn = item.querySelector('.add-btn');

    function updatePreview() {
      const grams = Number(gramsInput.value) || 0;
      const factor = grams / 100;
      const cal = Math.round(food.per100g.calories * factor);
      const p = round1(food.per100g.protein * factor);
      const c = round1(food.per100g.carbs * factor);
      const f = round1(food.per100g.fat * factor);
      preview.textContent = `${cal} cal, ${p}g protein, ${c}g carbs, ${f}g fat`;
    }

    top.addEventListener('click', () => {
      expand.classList.toggle('open');
      if (expand.classList.contains('open')) updatePreview();
    });
    gramsInput.addEventListener('input', updatePreview);
    addBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const grams = Number(gramsInput.value) || 100;
      const factor = grams / 100;
      await logEntry({
        description: food.description,
        quantity: grams,
        unit: 'g',
        calories: food.per100g.calories * factor,
        protein: food.per100g.protein * factor,
        carbs: food.per100g.carbs * factor,
        fat: food.per100g.fat * factor,
        source: 'usda',
      });
    });

    container.appendChild(item);
  }
}

// ---------- custom foods ----------

async function loadCustomFoods() {
  const container = el('customFoodsList');
  container.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const data = await api('/api/custom-foods');
    renderCustomFoods(data.customFoods);
  } catch (err) {
    container.innerHTML = `<p class="hint">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function renderCustomFoods(foods) {
  const container = el('customFoodsList');
  container.innerHTML = '';
  if (!foods.length) {
    container.innerHTML = '<p class="hint">No custom foods yet. Add one below.</p>';
    return;
  }
  for (const food of foods) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-item-top">
        <div>
          <div class="result-name">${escapeHtml(food.name)}</div>
          <div class="result-sub">${escapeHtml(food.servingLabel)}</div>
        </div>
        <div class="result-macros">${food.calories} cal / serving</div>
      </div>
      <div class="result-expand">
        <label>Servings: <input type="number" class="mult-input" value="1" min="0.1" step="0.1" /></label>
        <button class="primary-btn add-btn">Add</button>
        <button class="secondary-btn remove-btn">Remove</button>
        <div class="result-preview"></div>
      </div>
    `;
    const top = item.querySelector('.result-item-top');
    const expand = item.querySelector('.result-expand');
    const multInput = item.querySelector('.mult-input');
    const preview = item.querySelector('.result-preview');
    const addBtn = item.querySelector('.add-btn');
    const removeBtn = item.querySelector('.remove-btn');

    function updatePreview() {
      const mult = Number(multInput.value) || 0;
      preview.textContent = `${Math.round(food.calories * mult)} cal, ${round1(food.protein * mult)}g protein, ${round1(food.carbs * mult)}g carbs, ${round1(food.fat * mult)}g fat`;
    }

    top.addEventListener('click', () => {
      expand.classList.toggle('open');
      if (expand.classList.contains('open')) updatePreview();
    });
    multInput.addEventListener('input', updatePreview);
    addBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const mult = Number(multInput.value) || 1;
      await logEntry({
        description: food.name,
        quantity: mult,
        unit: 'x',
        calories: food.calories * mult,
        protein: food.protein * mult,
        carbs: food.carbs * mult,
        fat: food.fat * mult,
        source: 'custom',
      });
    });
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api(`/api/custom-foods/${food.id}`, { method: 'DELETE' });
      loadCustomFoods();
    });

    container.appendChild(item);
  }
}

el('saveCustomFoodBtn').addEventListener('click', async () => {
  const name = el('cfName').value.trim();
  if (!name) return showToast('Name is required');
  try {
    await api('/api/custom-foods', {
      method: 'POST',
      body: JSON.stringify({
        name,
        servingLabel: el('cfServingLabel').value.trim() || '1 serving',
        calories: Number(el('cfCalories').value) || 0,
        protein: Number(el('cfProtein').value) || 0,
        carbs: Number(el('cfCarbs').value) || 0,
        fat: Number(el('cfFat').value) || 0,
      }),
    });
    ['cfName', 'cfServingLabel', 'cfCalories', 'cfProtein', 'cfCarbs', 'cfFat'].forEach((id) => (el(id).value = ''));
    showToast('Saved custom food');
    loadCustomFoods();
  } catch (err) {
    showToast('Failed to save: ' + err.message);
  }
});

// ---------- meals ----------

async function loadMeals() {
  const container = el('mealsList');
  container.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const data = await api('/api/meals');
    renderMealsList(data.meals);
  } catch (err) {
    container.innerHTML = `<p class="hint">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

function renderMealsList(meals) {
  const container = el('mealsList');
  container.innerHTML = '';
  if (!meals.length) {
    container.innerHTML = '<p class="hint">No saved meals yet. Build one below.</p>';
    return;
  }
  for (const meal of meals) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-item-top" style="cursor:default;">
        <div>
          <div class="result-name">${escapeHtml(meal.name)}</div>
          <div class="result-sub">${meal.items.length} item${meal.items.length === 1 ? '' : 's'}</div>
        </div>
        <div class="result-macros">${meal.totals.calories} cal</div>
      </div>
      <div class="result-expand open">
        <button class="primary-btn log-meal-btn">Log meal</button>
        <button class="secondary-btn remove-meal-btn">Remove</button>
        <div class="result-preview">${meal.totals.protein}g protein, ${meal.totals.carbs}g carbs, ${meal.totals.fat}g fat</div>
      </div>
    `;
    item.querySelector('.log-meal-btn').addEventListener('click', async () => {
      try {
        await api(`/api/meals/${meal.id}/log`, { method: 'POST', body: JSON.stringify({ date: state.date }) });
        showToast(`Logged ${meal.name}`);
        await loadDayMacro();
        loadRecent();
        if (!el('view-home').classList.contains('hidden')) loadHome();
      } catch (err) {
        showToast('Failed to log meal: ' + err.message);
      }
    });
    item.querySelector('.remove-meal-btn').addEventListener('click', async () => {
      await api(`/api/meals/${meal.id}`, { method: 'DELETE' });
      loadMeals();
    });
    container.appendChild(item);
  }
}

el('mealSearchBtn').addEventListener('click', runMealSearch);
el('mealSearchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') runMealSearch();
});

async function runMealSearch() {
  const q = el('mealSearchInput').value.trim();
  if (!q) return;
  const container = el('mealSearchResults');
  container.innerHTML = '<p class="hint">Searching...</p>';
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(q)}`);
    renderMealSearchResults(data.results);
  } catch (err) {
    container.innerHTML = `<p class="hint">Search failed: ${escapeHtml(err.message)}</p>`;
  }
}

function renderMealSearchResults(results) {
  const container = el('mealSearchResults');
  container.innerHTML = '';
  if (!results.length) {
    container.innerHTML = '<p class="hint">No results.</p>';
    return;
  }
  for (const food of results.slice(0, 10)) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-item-top" style="cursor:default;">
        <div>
          <div class="result-name">${escapeHtml(food.description)}</div>
          <div class="result-sub">${Math.round(food.per100g.calories)} cal / 100g</div>
        </div>
      </div>
      <div class="result-expand open">
        <label>Grams: <input type="number" class="grams-input" value="100" min="1" /></label>
        <button class="primary-btn add-to-cart-btn">Add to meal</button>
      </div>
    `;
    const gramsInput = item.querySelector('.grams-input');
    item.querySelector('.add-to-cart-btn').addEventListener('click', () => {
      const grams = Number(gramsInput.value) || 100;
      const factor = grams / 100;
      addToMealCart({
        description: food.description,
        quantity: grams,
        unit: 'g',
        calories: Math.round(food.per100g.calories * factor),
        protein: round1(food.per100g.protein * factor),
        carbs: round1(food.per100g.carbs * factor),
        fat: round1(food.per100g.fat * factor),
      });
    });
    container.appendChild(item);
  }
}

function addToMealCart(item) {
  state.mealCart.push(item);
  renderMealCart();
  showToast(`Added ${item.description} to meal`);
}

function renderMealCart() {
  const container = el('mealCartList');
  container.innerHTML = '';
  if (!state.mealCart.length) {
    container.innerHTML = '<p class="hint">No items yet — search above and add foods.</p>';
  } else {
    state.mealCart.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'weight-entry';
      row.innerHTML = `
        <span class="weight-entry-value">${escapeHtml(item.description)} (${item.quantity}${item.unit === 'g' ? 'g' : 'x'})</span>
        <span class="weight-entry-steps">${item.calories} cal</span>
        <button class="del-btn remove-cart-item" data-idx="${idx}">&times;</button>
      `;
      container.appendChild(row);
    });
    container.querySelectorAll('.remove-cart-item').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.mealCart.splice(Number(btn.dataset.idx), 1);
        renderMealCart();
      });
    });
  }
  const totals = state.mealCart.reduce(
    (acc, it) => {
      acc.calories += it.calories;
      acc.protein += it.protein;
      acc.carbs += it.carbs;
      acc.fat += it.fat;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  el('mealCartTotals').textContent = state.mealCart.length
    ? `Total: ${Math.round(totals.calories)} cal, ${round1(totals.protein)}g protein, ${round1(totals.carbs)}g carbs, ${round1(totals.fat)}g fat`
    : '';
}

el('saveMealBtn').addEventListener('click', async () => {
  const name = el('mealNameInput').value.trim();
  if (!name) return showToast('Meal name is required');
  if (!state.mealCart.length) return showToast('Add at least one item first');
  try {
    await api('/api/meals', { method: 'POST', body: JSON.stringify({ name, items: state.mealCart }) });
    showToast(`Saved meal "${name}"`);
    state.mealCart = [];
    renderMealCart();
    el('mealNameInput').value = '';
    el('mealSearchResults').innerHTML = '';
    el('mealSearchInput').value = '';
    loadMeals();
  } catch (err) {
    showToast('Failed to save meal: ' + err.message);
  }
});

// ---------- quick add ----------

el('qaLogBtn').addEventListener('click', async () => {
  const description = el('qaDescription').value.trim();
  if (!description) return showToast('Description is required');
  const calories = Number(el('qaCalories').value) || 0;
  const protein = Number(el('qaProtein').value) || 0;
  const carbs = Number(el('qaCarbs').value) || 0;
  const fat = Number(el('qaFat').value) || 0;

  try {
    if (el('qaSave').checked) {
      await api('/api/custom-foods', {
        method: 'POST',
        body: JSON.stringify({ name: description, calories, protein, carbs, fat }),
      });
    }
    await logEntry({ description, quantity: 1, unit: 'x', calories, protein, carbs, fat, source: 'manual' });
    ['qaDescription', 'qaCalories', 'qaProtein', 'qaCarbs', 'qaFat'].forEach((id) => (el(id).value = ''));
    el('qaSave').checked = false;
  } catch (err) {
    showToast('Failed to log: ' + err.message);
  }
});

// ================= PHYSICAL ATTRIBUTES =================

async function loadBodyData() {
  try {
    const data = await api('/api/body');
    state.bodyLogs = data.bodyLogs;
    state.weightUnit = data.unit || 'lbs';
    state.targetWeight = data.targetWeight;
    el('bodyWeightUnitSelect').value = state.weightUnit;
    el('targetWeightInput').value = state.targetWeight != null ? state.targetWeight : '';

    const todaysEntry = state.bodyLogs.find((b) => b.date === state.date);
    el('bodyWeightInput').value = todaysEntry && todaysEntry.weight != null ? todaysEntry.weight : '';
    el('bodyFatInput').value = todaysEntry && todaysEntry.bodyFatPct != null ? todaysEntry.bodyFatPct : '';
    el('waistInput').value = todaysEntry && todaysEntry.waist != null ? todaysEntry.waist : '';

    renderBodySummary(todaysEntry);
    renderBodyHistory(state.bodyLogs);
  } catch (err) {
    showToast('Failed to load physical attributes: ' + err.message);
  }
}

function renderBodySummary(entry) {
  const weight = entry && entry.weight != null ? entry.weight : null;
  const unit = (entry && entry.unit) || state.weightUnit;
  el('bodyWeightVal').textContent = weight != null ? weight : '—';
  el('bodyWeightUnit').textContent = weight != null ? unit : '';

  if (state.targetWeight != null && weight != null) {
    const diff = round1(weight - state.targetWeight);
    const dir = diff > 0 ? 'above' : diff < 0 ? 'below' : 'at';
    el('bodyWeightTargetHint').textContent =
      diff === 0 ? `At target (${state.targetWeight} ${unit})` : `${Math.abs(diff)} ${unit} ${dir} target (${state.targetWeight} ${unit})`;
  } else if (state.targetWeight != null) {
    el('bodyWeightTargetHint').textContent = `Target: ${state.targetWeight} ${unit}`;
  } else {
    el('bodyWeightTargetHint').textContent = '';
  }

  const bf = entry && entry.bodyFatPct != null ? entry.bodyFatPct : null;
  el('bodyBfVal').textContent = bf != null ? bf + '%' : '—';
}

function renderBodyHistory(logs) {
  const container = el('bodyHistoryList');
  const trend = el('bodyTrend');
  container.innerHTML = '';

  if (!logs.length) {
    container.innerHTML = '<p class="hint">Nothing logged yet.</p>';
    trend.textContent = '';
    return;
  }

  const ascending = logs;
  let lastWeight = null;
  const withDeltas = ascending.map((entry) => {
    let weightDelta = null;
    if (entry.weight != null && lastWeight != null) weightDelta = round1(entry.weight - lastWeight);
    if (entry.weight != null) lastWeight = entry.weight;
    return { ...entry, weightDelta };
  });

  const weightEntries = ascending.filter((e) => e.weight != null);
  if (weightEntries.length > 1) {
    const first = weightEntries[0];
    const last = weightEntries[weightEntries.length - 1];
    const totalChange = round1(last.weight - first.weight);
    const dir = totalChange > 0 ? '+' : '';
    trend.textContent = `${dir}${totalChange}${last.unit} since ${first.date} (${weightEntries.length} weigh-ins)`;
  } else {
    trend.textContent = '';
  }

  const recent = [...withDeltas].reverse().slice(0, 15);
  for (const entry of recent) {
    const row = document.createElement('div');
    row.className = 'weight-entry';
    let deltaHtml = '';
    if (entry.weightDelta !== null) {
      const cls = entry.weightDelta > 0 ? 'up' : entry.weightDelta < 0 ? 'down' : 'flat';
      const sign = entry.weightDelta > 0 ? '+' : '';
      deltaHtml = `<span class="weight-entry-delta ${cls}">${sign}${entry.weightDelta}</span>`;
    } else {
      deltaHtml = `<span class="weight-entry-delta flat">&mdash;</span>`;
    }
    const weightText = entry.weight != null ? `${entry.weight} ${escapeHtml(entry.unit || '')}` : '—';
    const bfText = entry.bodyFatPct != null ? `${entry.bodyFatPct}% BF` : '';
    const waistText = entry.waist != null ? `${entry.waist} waist` : '';
    const extra = [bfText, waistText].filter(Boolean).join(' · ');
    row.innerHTML = `
      <span class="weight-entry-date">${escapeHtml(entry.date)}</span>
      <span class="weight-entry-value">${weightText}</span>
      ${deltaHtml}
      <span class="weight-entry-steps">${escapeHtml(extra)}</span>
      <button class="del-btn weight-del-btn" title="Delete" data-id="${entry.id}">&times;</button>
    `;
    container.appendChild(row);
  }

  container.querySelectorAll('.weight-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/body/${btn.dataset.id}`, { method: 'DELETE' });
        loadBodyData();
      } catch (err) {
        showToast('Failed to delete: ' + err.message);
      }
    });
  });
}

el('logBodyBtn').addEventListener('click', async () => {
  const weightRaw = el('bodyWeightInput').value;
  const bfRaw = el('bodyFatInput').value;
  const waistRaw = el('waistInput').value;
  const weight = weightRaw !== '' ? Number(weightRaw) : undefined;
  const bodyFatPct = bfRaw !== '' ? Number(bfRaw) : undefined;
  const waist = waistRaw !== '' ? Number(waistRaw) : undefined;

  if (weight === undefined && bodyFatPct === undefined && waist === undefined) {
    return showToast('Enter at least one value');
  }
  try {
    await api('/api/body', {
      method: 'POST',
      body: JSON.stringify({ date: state.date, weight, unit: el('bodyWeightUnitSelect').value, bodyFatPct, waist }),
    });
    showToast(`Logged for ${state.date}`);
    await loadBodyData();
    if (!el('view-home').classList.contains('hidden')) loadHome();
  } catch (err) {
    showToast('Failed to log: ' + err.message);
  }
});

el('saveTargetWeightBtn').addEventListener('click', async () => {
  const val = el('targetWeightInput').value;
  try {
    const settings = await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({ targetWeight: val === '' ? null : Number(val) }),
    });
    state.targetWeight = settings.targetWeight;
    showToast('Target weight saved');
    renderBodySummary(state.bodyLogs.find((b) => b.date === state.date));
  } catch (err) {
    showToast('Failed to save: ' + err.message);
  }
});

// ================= WORKOUTS (steps + exercise) =================

async function loadStepsData() {
  try {
    const data = await api('/api/steps');
    state.stepLogs = data.stepLogs;
    if (state.goals) state.goals.steps = data.goal;
    const todaysEntry = state.stepLogs.find((s) => s.date === state.date);
    el('stepsInput').value = todaysEntry ? todaysEntry.steps : '';
    renderStepsSummary(todaysEntry);
  } catch (err) {
    showToast('Failed to load steps: ' + err.message);
  }
}

function renderStepsSummary(entry) {
  const steps = entry ? entry.steps : 0;
  const goal = (state.goals && state.goals.steps) || 0;
  el('stepsVal').textContent = steps.toLocaleString();
  el('stepsGoal').textContent = goal.toLocaleString();
  el('stepsBar').style.width = pct(steps, goal) + '%';
}

el('editStepGoalBtn').addEventListener('click', () => {
  el('goalSteps').value = state.goals.steps;
  el('stepGoalForm').classList.remove('hidden');
});
el('cancelStepGoalBtn').addEventListener('click', () => el('stepGoalForm').classList.add('hidden'));
el('saveStepGoalBtn').addEventListener('click', async () => {
  const steps = Number(el('goalSteps').value);
  if (!steps || steps <= 0) return showToast('Enter a valid step goal');
  try {
    const goals = await api('/api/goals', { method: 'POST', body: JSON.stringify({ steps }) });
    state.goals = goals;
    el('stepGoalForm').classList.add('hidden');
    renderStepsSummary(state.stepLogs.find((s) => s.date === state.date));
    showToast('Step goal updated');
    if (!el('view-home').classList.contains('hidden')) loadHome();
  } catch (err) {
    showToast('Failed to save step goal: ' + err.message);
  }
});

el('logStepsBtn').addEventListener('click', async () => {
  const raw = el('stepsInput').value;
  if (raw === '') return showToast('Enter a step count');
  const steps = Number(raw);
  if (!Number.isFinite(steps) || steps < 0) return showToast('Enter a valid step count');
  try {
    await api('/api/steps', { method: 'POST', body: JSON.stringify({ date: state.date, steps }) });
    showToast(`Logged ${steps} steps for ${state.date}`);
    await loadStepsData();
    if (!el('view-home').classList.contains('hidden')) loadHome();
  } catch (err) {
    showToast('Failed to log steps: ' + err.message);
  }
});

async function loadWorkoutsView() {
  try {
    const data = await api('/api/workouts');
    state.workouts = data.workouts;
    renderStrengthList();
    renderCardioList();
  } catch (err) {
    showToast('Failed to load workouts: ' + err.message);
  }
}

function renderWorkoutDelButtons(container, onDeleted) {
  container.querySelectorAll('.workout-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/workouts/${btn.dataset.id}`, { method: 'DELETE' });
        await loadWorkoutsView();
        if (!el('view-home').classList.contains('hidden')) loadHome();
      } catch (err) {
        showToast('Failed to delete: ' + err.message);
      }
    });
  });
}

function renderStrengthList() {
  const container = el('strengthList');
  const todays = state.workouts
    .filter((w) => w.date === state.date && w.category === 'strength')
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  container.innerHTML = '';
  if (!todays.length) {
    container.innerHTML = '<p class="hint">No strength sets logged for this day.</p>';
    return;
  }
  for (const w of todays) {
    const item = document.createElement('div');
    item.className = 'result-item';
    const details = [];
    if (w.reps != null && w.reps > 0) details.push(`${w.reps} reps`);
    if (w.weightLbs != null && w.weightLbs > 0) details.push(`${w.weightLbs} lbs`);
    item.innerHTML = `
      <div class="result-item-top" style="cursor:default;">
        <div>
          <div class="result-name">${escapeHtml(w.type)}</div>
          <div class="result-sub">${escapeHtml(details.join(' @ '))}</div>
        </div>
        <div class="result-macros">${w.caloriesBurned ? w.caloriesBurned + ' cal burned' : ''}</div>
      </div>
      <div class="result-expand open">
        <button class="secondary-btn workout-del-btn" data-id="${w.id}">Remove</button>
      </div>
    `;
    container.appendChild(item);
  }
  renderWorkoutDelButtons(container);
}

function renderCardioList() {
  const container = el('cardioList');
  const todays = state.workouts
    .filter((w) => w.date === state.date && w.category === 'cardio')
    .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  container.innerHTML = '';
  if (!todays.length) {
    container.innerHTML = '<p class="hint">No cardio logged for this day.</p>';
    return;
  }
  for (const w of todays) {
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <div class="result-item-top" style="cursor:default;">
        <div>
          <div class="result-name">${escapeHtml(w.type)}</div>
          <div class="result-sub">${w.durationMin ? w.durationMin + ' min' : ''}</div>
        </div>
        <div class="result-macros">${w.caloriesBurned ? w.caloriesBurned + ' cal burned' : ''}</div>
      </div>
      <div class="result-expand open">
        <button class="secondary-btn workout-del-btn" data-id="${w.id}">Remove</button>
      </div>
    `;
    container.appendChild(item);
  }
  renderWorkoutDelButtons(container);
}

el('logStrengthBtn').addEventListener('click', async () => {
  const type = el('strengthType').value.trim();
  if (!type) return showToast('Enter an exercise name');
  const reps = Number(el('strengthReps').value) || 0;
  const weightLbs = Number(el('strengthWeight').value) || 0;
  const caloriesBurned = Number(el('strengthCalories').value) || 0;
  try {
    await api('/api/workouts', {
      method: 'POST',
      body: JSON.stringify({ date: state.date, category: 'strength', type, reps, weightLbs, caloriesBurned }),
    });
    showToast('Set logged');
    ['strengthType', 'strengthReps', 'strengthWeight', 'strengthCalories'].forEach((id) => (el(id).value = ''));
    await loadWorkoutsView();
    if (!el('view-home').classList.contains('hidden')) loadHome();
  } catch (err) {
    showToast('Failed to log set: ' + err.message);
  }
});

el('logCardioBtn').addEventListener('click', async () => {
  const type = el('cardioType').value.trim();
  if (!type) return showToast('Enter an activity name');
  const durationMin = Number(el('cardioDuration').value) || 0;
  const caloriesBurned = Number(el('cardioCalories').value) || 0;
  try {
    await api('/api/workouts', {
      method: 'POST',
      body: JSON.stringify({ date: state.date, category: 'cardio', type, durationMin, caloriesBurned }),
    });
    showToast('Cardio logged');
    ['cardioType', 'cardioDuration', 'cardioCalories'].forEach((id) => (el(id).value = ''));
    await loadWorkoutsView();
    if (!el('view-home').classList.contains('hidden')) loadHome();
  } catch (err) {
    showToast('Failed to log cardio: ' + err.message);
  }
});

// ================= HOME (dashboard & trends) =================

let weightChartInstance = null;
let caloriesChartInstance = null;
let stepsChartInstance = null;

function chartTheme() {
  return { grid: '#263252', text: '#8b96b4' };
}

async function loadHome() {
  try {
    const end = state.date;
    const start = toDateStr(addDays(fromDateStr(end), -13));
    const rangeData = await api(`/api/log/range?start=${start}&end=${end}`);
    state.goals = rangeData.goals || state.goals;

    renderHomeSummary(rangeData.days);
    renderStreaks(rangeData.days);

    const chartsAvailable = typeof Chart !== 'undefined';
    el('chartsUnavailableMsg').classList.toggle('hidden', chartsAvailable);
    if (chartsAvailable) {
      renderCaloriesChart(rangeData.days);
      renderStepsChartHome(start, end);
      renderWeightChartHome();
    }
  } catch (err) {
    showToast('Failed to load home: ' + err.message);
  }
}

function renderHomeSummary(days) {
  const today = days[days.length - 1];
  el('homeCaloriesVal').textContent = today.calories;
  el('homeCaloriesGoal').textContent = state.goals.calories;
  el('homeCaloriesBar').style.width = pct(today.calories, state.goals.calories) + '%';

  const todaysWorkouts = state.workouts.filter((w) => w.date === state.date);
  const burned = todaysWorkouts.reduce((s, w) => s + w.caloriesBurned, 0);
  const net = today.calories - burned;
  el('netCaloriesVal').textContent = net;
  el('netCaloriesHint').textContent = burned
    ? `${today.calories} eaten − ${burned} burned`
    : `${today.calories} eaten, no workouts logged`;

  let bodyEntry = state.bodyLogs.find((b) => b.date === state.date && b.weight != null);
  if (!bodyEntry) {
    bodyEntry = [...state.bodyLogs].reverse().find((b) => b.date <= state.date && b.weight != null);
  }
  el('homeWeightVal').textContent = bodyEntry ? `${bodyEntry.weight} ${bodyEntry.unit}` : '—';
  el('homeWeightHint').textContent = bodyEntry ? `as of ${bodyEntry.date}` : 'No weigh-ins yet';

  const stepsEntry = state.stepLogs.find((s) => s.date === state.date);
  const steps = stepsEntry ? stepsEntry.steps : 0;
  el('homeStepsVal').textContent = steps.toLocaleString();
  el('homeStepsGoal').textContent = (state.goals.steps || 0).toLocaleString();
  el('homeStepsBar').style.width = pct(steps, state.goals.steps) + '%';
}

function renderStreaks(days) {
  const grid = el('streaksGrid');
  const last7 = days.slice(-7);
  const loggedDays = last7.filter((d) => d.calories > 0).length;
  const calorieHits = last7.filter((d) => d.calories > 0 && d.calories <= state.goals.calories).length;
  const stepsHitDays = last7.filter((d) => {
    const entry = state.stepLogs.find((s) => s.date === d.date);
    return entry && entry.steps >= state.goals.steps;
  }).length;
  const avgCalories = loggedDays ? Math.round(last7.reduce((s, d) => s + d.calories, 0) / last7.length) : 0;

  grid.innerHTML = `
    <div class="streak-stat"><div class="streak-num">${loggedDays}/7</div><div class="streak-label">Days logged</div></div>
    <div class="streak-stat"><div class="streak-num">${calorieHits}/7</div><div class="streak-label">Under calorie goal</div></div>
    <div class="streak-stat"><div class="streak-num">${stepsHitDays}/7</div><div class="streak-label">Hit step goal</div></div>
    <div class="streak-stat"><div class="streak-num">${avgCalories}</div><div class="streak-label">Avg calories/day</div></div>
  `;
}

function renderCaloriesChart(days) {
  if (typeof Chart === 'undefined') return;
  const ctx = el('caloriesChart');
  const theme = chartTheme();
  const labels = days.map((d) => d.date.slice(5));
  const data = days.map((d) => d.calories);
  if (caloriesChartInstance) caloriesChartInstance.destroy();
  caloriesChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Calories', data, backgroundColor: '#5b8cff' },
        {
          label: 'Goal',
          data: days.map(() => state.goals.calories),
          type: 'line',
          borderColor: '#dcae4a',
          borderDash: [5, 5],
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: theme.text } } },
      scales: {
        x: { ticks: { color: theme.text }, grid: { color: theme.grid } },
        y: { ticks: { color: theme.text }, grid: { color: theme.grid } },
      },
    },
  });
}

function renderStepsChartHome(start, end) {
  if (typeof Chart === 'undefined') return;
  const ctx = el('stepsChart');
  const theme = chartTheme();
  const days = [];
  let d = fromDateStr(start);
  const endD = fromDateStr(end);
  while (d <= endD) {
    days.push(toDateStr(d));
    d = addDays(d, 1);
  }
  const data = days.map((day) => {
    const entry = state.stepLogs.find((s) => s.date === day);
    return entry ? entry.steps : 0;
  });
  if (stepsChartInstance) stepsChartInstance.destroy();
  stepsChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map((day) => day.slice(5)),
      datasets: [
        { label: 'Steps', data, backgroundColor: '#9b6bde' },
        {
          label: 'Goal',
          data: days.map(() => state.goals.steps),
          type: 'line',
          borderColor: '#3fbd82',
          borderDash: [5, 5],
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: theme.text } } },
      scales: {
        x: { ticks: { color: theme.text }, grid: { color: theme.grid } },
        y: { ticks: { color: theme.text }, grid: { color: theme.grid } },
      },
    },
  });
}

function renderWeightChartHome() {
  if (typeof Chart === 'undefined') return;
  const ctx = el('weightChart');
  const theme = chartTheme();
  const entries = state.bodyLogs.filter((b) => b.weight != null).slice(-30);
  if (weightChartInstance) {
    weightChartInstance.destroy();
    weightChartInstance = null;
  }
  el('weightChartEmpty').classList.toggle('hidden', entries.length > 0);
  if (!entries.length) return;
  weightChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: entries.map((e) => e.date.slice(5)),
      datasets: [
        {
          label: `Weight (${entries[entries.length - 1].unit})`,
          data: entries.map((e) => e.weight),
          borderColor: '#5b8cff',
          backgroundColor: 'rgba(91,140,255,0.15)',
          tension: 0.25,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: theme.text } } },
      scales: {
        x: { ticks: { color: theme.text }, grid: { color: theme.grid } },
        y: { ticks: { color: theme.text }, grid: { color: theme.grid } },
      },
    },
  });
}

el('exportBtn').addEventListener('click', () => {
  window.location.href = '/api/export';
});

// ---------- PWA ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ---------- init ----------

async function init() {
  el('dateInput').value = state.date;
  await loadDayMacro();
  await Promise.all([loadBodyData(), loadStepsData(), loadWorkoutsView()]);
  loadRecent();
  await loadHome();
}

init();
