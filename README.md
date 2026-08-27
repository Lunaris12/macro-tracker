# Macro Tracker

A personal web app for logging food and tracking daily calories, macros (protein, carbs, fat), body weight, and step count.

## Features

- Two views, switchable from the top nav: **Macro Tracking** and **Weight & Steps**
- Search real foods via the USDA FoodData Central database and log by grams
- Save your own reusable "custom foods" (e.g. homemade meals) with fixed macros per serving
- Daily log with delete, day by day navigation, and calorie/macro goal progress bars
- Log your body weight per day (lbs or kg) and daily step count, with history and day-over-day trend
- Step count has its own editable daily goal, just like the macro goals
- Data is stored locally in a JSON file (`data/store.json`)

## Setup

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
cd macro-tracker
npm install
cp .env.example .env
```

Get a free USDA API key at https://fdc.nal.usda.gov/api-key-signup and put it in `.env`:

```
USDA_API_KEY=your_key_here
```

Without your own key the app falls back to the shared `DEMO_KEY`, which is rate-limited to roughly 30 requests/hour and will start failing quickly.

## Run

```bash
npm start
```

Then open http://localhost:3000

## Notes

- All your logged food, custom foods, and goals live in `data/store.json`. Back that file up if you want to keep history.
- Macro values from search results are per 100g, enter how many grams you ate before adding.
