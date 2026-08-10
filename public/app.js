const state = {
  date: toDateStr(new Date()),
  goals: { calories: 2000, protein: 150, carbs: 200, fat: 65 },
  weightLogs: [],
  weightUnit: 'lbs',
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

// ---------- day loading / summary ----------

async function loadDay() {
  el('dateInput').value = state.date;
  try {
    const data = await api(`/api/log?date=${state.date}`);
    state.goals = data.goals;
    renderSummary(data.totals, data.goals);
    renderLog(data.entries);
  } catch (err) {
    showToast('Failed to load day: ' + err.message);
  }
  loadWeightData();
}

function pct(val, goal) {
  if (!goal) return 0;
  return Math.max(0, Math.min(100, (val / goal) * 100));
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
        <div class="log-food-name">${escapeHtml(e.description)}</div>
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
        loadDay();
      } catch (err) {
        showToast('Failed to delete: ' + err.message);
      }
    });
  });
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

async function logEntry(entry) {
  await api('/api/log', { method: 'POST', body: JSON.stringify({ date: state.date, ...entry }) });
  showToast(`Logged ${entry.description}`);
  loadDay();
}

// ---------- date navigation ----------

el('dateInput').addEventListener('change', () => {
  state.date = el('dateInput').value;
  loadDay();
});
el('prevDay').addEventListener('click', () => {
  const d = fromDateStr(state.date);
  d.setDate(d.getDate() - 1);
  state.date = toDateStr(d);
  loadDay();
});
el('nextDay').addEventListener('click', () => {
  const d = fromDateStr(state.date);
  d.setDate(d.getDate() + 1);
  state.date = toDateStr(d);
  loadDay();
});
el('todayBtn').addEventListener('click', () => {
  state.date = toDateStr(new Date());
  loadDay();
});

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
    loadDay();
  } catch (err) {
    showToast('Failed to save goals: ' + err.message);
  }
});

// ---------- body weight ----------

async function loadWeightData() {
  try {
    const data = await api('/api/weight');
    state.weightLogs = data.weightLogs;
    state.weightUnit = data.unit || 'lbs';
    el('weightUnitSelect').value = state.weightUnit;

    const todaysEntry = state.weightLogs.find((w) => w.date === state.date);
    el('weightInput').value = todaysEntry ? todaysEntry.weight : '';

    renderWeightHistory(state.weightLogs);
  } catch (err) {
    showToast('Failed to load weight: ' + err.message);
  }
}

function renderWeightHistory(logs) {
  const container = el('weightHistoryList');
  const trend = el('weightTrend');
  container.innerHTML = '';

  if (!logs.length) {
    container.innerHTML = '<p class="hint">No weight logged yet.</p>';
    trend.textContent = '';
    return;
  }

  // logs are sorted ascending by date; compute deltas vs previous entry
  const ascending = logs;
  const withDeltas = ascending.map((entry, i) => {
    const prev = i > 0 ? ascending[i - 1] : null;
    const delta = prev ? round1(entry.weight - prev.weight) : null;
    return { ...entry, delta };
  });

  const first = ascending[0];
  const last = ascending[ascending.length - 1];
  const totalChange = round1(last.weight - first.weight);
  if (ascending.length > 1) {
    const dir = totalChange > 0 ? '+' : '';
    trend.textContent = `${dir}${totalChange}${last.unit} since ${first.date} (${ascending.length} entries)`;
  } else {
    trend.textContent = '';
  }

  // show most recent first, capped to last 15
  const recent = [...withDeltas].reverse().slice(0, 15);
  for (const entry of recent) {
    const row = document.createElement('div');
    row.className = 'weight-entry';
    let deltaHtml = '';
    if (entry.delta !== null) {
      const cls = entry.delta > 0 ? 'up' : entry.delta < 0 ? 'down' : 'flat';
      const sign = entry.delta > 0 ? '+' : '';
      deltaHtml = `<span class="weight-entry-delta ${cls}">${sign}${entry.delta}</span>`;
    } else {
      deltaHtml = `<span class="weight-entry-delta flat">&mdash;</span>`;
    }
    row.innerHTML = `
      <span class="weight-entry-date">${escapeHtml(entry.date)}</span>
      <span class="weight-entry-value">${entry.weight} ${escapeHtml(entry.unit)}</span>
      ${deltaHtml}
      <button class="del-btn weight-del-btn" title="Delete" data-id="${entry.id}">&times;</button>
    `;
    container.appendChild(row);
  }

  container.querySelectorAll('.weight-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/weight/${btn.dataset.id}`, { method: 'DELETE' });
        loadWeightData();
      } catch (err) {
        showToast('Failed to delete: ' + err.message);
      }
    });
  });
}

el('logWeightBtn').addEventListener('click', async () => {
  const weight = Number(el('weightInput').value);
  if (!weight || weight <= 0) return showToast('Enter a valid weight');
  try {
    await api('/api/weight', {
      method: 'POST',
      body: JSON.stringify({ date: state.date, weight, unit: el('weightUnitSelect').value }),
    });
    showToast(`Logged ${weight} ${el('weightUnitSelect').value} for ${state.date}`);
    loadWeightData();
  } catch (err) {
    showToast('Failed to log weight: ' + err.message);
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

function round1(n) {
  return Math.round(n * 10) / 10;
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

// ---------- init ----------

loadDay();
