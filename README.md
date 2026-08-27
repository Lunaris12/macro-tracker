# Personal Health Webapp

A personal web app for tracking calories, macros, physical attributes, and workouts, all in one place.

## Features

Four views, switchable from the top nav:

- **Home** — dashboard with today's snapshot (calories, net calories, weight, steps), a weekly summary (days logged, calorie/step goal streaks, average calories), and trend charts for weight, calories, and steps over the last 14 days.
- **Macro Tracking** — search real foods via the USDA FoodData Central database, save reusable "custom foods," build and save multi-item **meals** you can log in one tap, quick-add manual entries, a "recently logged" quick-log list, and a "copy previous day" button. Daily log with delete, day-by-day navigation, and calorie/macro goal progress bars.
- **Physical Attributes** — log weight (lbs or kg), body fat %, and waist measurement per day, with a settable target weight, history, and day-over-day trend.
- **Workouts** — log daily step count against an editable step goal, plus individual exercise entries (type, duration, calories burned) that feed into Home's net calorie calculation.

Other features:

- Installable as a PWA (add to your phone/desktop home screen) with basic offline support for the app shell.
- One-click data export/backup as a JSON file from the Home view.
- Data is stored locally in a single JSON file (`data/store.json`).

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

- All your logged food, meals, custom foods, physical attributes, steps, workouts, and goals live in `data/store.json`. Back that file up if you want to keep history (or use the "Export data" button on the Home view).
- Macro values from search results are per 100g, enter how many grams you ate before adding.
- If you're upgrading from an older version of this app, your existing weight log entries are migrated automatically into the new Physical Attributes / Workouts data on first run.
