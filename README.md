# EVEN EDITH

**E.D.I.T.H.** (Even Dead, I'm The Hero): a Stark-style AI assistant for Even Realities G2 glasses + R1 ring, built with the Even Hub SDK.

Hold the ring and talk, or turn on hands-free and say "Hey EDITH". EDITH answers on the HUD.

## What she does

- **Ask anything**: Gemini answers in a dry, terse voice, with **Google Search** for news, prices, stock quotes, flight status and anything current. Falls back to Wikipedia/DuckDuckGo past the free search quota.
- **Hands-free**: "Hey EDITH, what's the weather?" works in one breath, or say "Hey EDITH" and then your question. Opt in on the phone; uses more battery and Groq quota (see below).
- **Walking navigation**: "take me to the British Museum" / "navigate to the nearest pharmacy": route map, turn arrow, distance and street, automatic rerouting.
- **Live captions / translation** with **rewind** (swipe up) and **You/Them labels** when the Even app can tell who's talking. Ask "what did they just say?" afterwards.
- **Meeting mode**: records, transcribes with speaker labels, and saves a summary with action items to notes. Share any note from the phone.
- **Recipes and guides**: "walk me through carbonara" or paste one on the phone; one step per screen, press for a step's timer.
- **Lists**: "add milk and eggs to my shopping list"; tick items off on the glasses with the ring, or on the phone.
- **Quick maths, offline**: "15% of 80", "split £84 between 3 with a 12% tip", "5 miles in km" answer instantly with no signal.
- **Transit**: next buses, trains and tubes from the stops around you. **Sports scores**, **crypto prices**.
- **Walk/run/ride tracker**: time, distance and pace; saved to notes.
- **Google Calendar**: link it with a small Apps Script in your own account (instructions on the phone page). Events show on the dashboard, with heads-ups; "add lunch with Sam on Friday" creates them.
- **Offline fallback**: with no connection, time, schedule, timers, notes, lists and the last weather still answer from the phone.
- **Memory**: "EDITH, remember I parked on level 3." Recalled later; manage it on the phone.
- **Timers, reminders, notes, currency, weather**, with alerts on the glasses.
- **Dashboard**, **map**, **radar** ("find a cafe nearby"), **teleprompter**, **daily briefing**.
- **Protocols**: focus (Pomodoro), night (dim), stealth (minimal), standard. Plus a few undocumented ones.
- **Suit diagnostics**: glasses and phone battery, network, GPS, voice quota.
- **Personalities**: EDITH (dry, tactical), FRIDAY (warm, Irish) or JARVIS (formal, British).
- **Phone mirror and remote**: a live copy of the HUD on the phone, with controls to drive the glasses while someone else wears them.

### About hands-free

The glasses have no on-device wake word engine, so hands-free keeps the mic open while EDITH is open on the glasses,
cuts out each phrase you say, and sends it to Groq Whisper to check whether it starts with "Hey EDITH" (or FRIDAY/JARVIS).
Speech the Even app tags as someone else is skipped. Each check is one Groq request, so in a long conversation it can
use a good part of the free daily quota; EDITH pauses hands-free at 95% and says so. It doesn't work while the app is
closed or in the background.

Everything uses free tiers or free public services. Bring your own keys: paste your Gemini and Groq API keys into the phone-side settings page. No keys are stored in this repo or the package.

*A fan project, not affiliated with Marvel or Stark Industries.* Map tiles © Esri, HERE, Garmin, © OpenStreetMap contributors. Places by Photon and Nominatim (OpenStreetMap). Walking routes by OSRM on FOSSGIS servers. Transit by Transitous. Weather by Open-Meteo. Crypto prices by CoinGecko. Scores from ESPN.

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
