# EVEN EDITH

**E.D.I.T.H.** (Even Dead, I'm The Hero): a Stark-style AI assistant for Even Realities G2 glasses + R1 ring, built with the Even Hub SDK.

Hold the ring, talk, and EDITH answers on the HUD.

## What she does

- **Ask anything**: Gemini answers in a dry, terse voice; Wikipedia/DuckDuckGo lookups for facts.
- **Memory**: "EDITH, remember I parked on level 3." Recalled later; manage it on the phone.
- **Timers, reminders, calendar, notes, currency, weather**, with alerts on the glasses.
- **Dashboard**: "EDITH, open dashboard": time, weather, glasses battery, timers, schedule, latest note.
- **Map**: "EDITH, open map" / "where am I": your phone location on a street map. Swipe to zoom.
- **Radar**: "find a pharmacy nearby": numbered blips with distance and direction.
- **Live captions / translation**: subtitles of nearby speech; translate mode turns any language into English.
- **Meeting mode**: records, transcribes, and saves a summary with action items to notes.
- **Teleprompter**: paste a script on the phone, swipe through it on the glasses.
- **Protocols**: focus (Pomodoro), night (dim), stealth (minimal), standard.
- **Daily briefing** at a time you choose, and a heads-up 10 minutes before events.
- **Phone mirror and remote**: a live copy of the HUD on the phone, with controls to drive the glasses while someone else wears them.

Everything uses free tiers or free public services. Bring your own keys: paste your Gemini and Groq API keys into the phone-side settings page. No keys are stored in this repo or the package.

*A fan project, not affiliated with Marvel or Stark Industries.* Map tiles © Esri, HERE, Garmin, © OpenStreetMap contributors. Places by Photon and Nominatim (OpenStreetMap). Weather by Open-Meteo.

## Develop

```bash
npm install
npm run dev     # Vite dev server on your LAN
npm run sim     # in a second terminal: open the simulator
```

Opening the dev server in a normal browser also works: the phone page's mirror shows what the glasses would display.

## Package

```bash
npx evenhub login
npm run pack    # builds and writes even-edith.ehpk
npx evenhub upload even-edith.ehpk -m "what changed"
```
