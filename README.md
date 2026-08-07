# Macro Tracker

A personal web app for logging food and tracking daily calories and macros (protein, carbs, fat).

## Features

- Search real foods via the USDA FoodData Central database and log by grams
- Save your own reusable "custom foods" (e.g. homemade meals) with fixed macros per serving
- Quick-add one-off entries by typing macros directly
- Daily log with delete, per-day navigation, and calorie/macro goal progress bars
- Data is stored locally in a JSON file (`data/store.json`) — nothing leaves your machine except food searches

## Setup

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
cd macro-tracker
npm install
cp .env.example .env
```

Get a free USDA API key at https://fdc.nal.usda.gov/api-key-signup (takes a minute, no cost) and put it in `.env`:

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
- Macro values from search results are per 100g; enter how many grams you ate before adding.
- To run this permanently on your own machine, you could add it to your startup apps, or run it in the background with a tool like `pm2`.
