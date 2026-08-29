# MBTA Trip → JSON

Paste an MBTA trip itinerary blurb (Route / Start / End / Time On / Time Off) and get structured JSON.

```bash
npm install
npm run dev
```

## Google Maps

The map is loaded only when **Show map** is selected.

1. In Google Cloud, enable billing, **Maps JavaScript API**, and **Routes API**.
2. Create a browser API key restricted to those APIs and your HTTP referrers
   (`http://localhost:5173/*` while developing).
3. Copy `.env.example` to `.env.local` and add the key:

```dotenv
VITE_GOOGLE_MAPS_API_KEY=your_browser_api_key
```

Restart `npm run dev` after changing environment variables. Browser map keys
are visible to clients by design, so API and referrer restrictions are
required. A custom map ID is optional.
