# JARVIS

**J.A.R.V.I.S.** (Just A Rather Very Intelligent System): a Stark-style AI assistant for Even Realities G2 glasses + R1 ring, built with the Even Hub SDK.

Hold the ring and talk, or turn on hands-free and say "Jarvis, …". Jarvis answers on the HUD.

## What it does

- **Ask anything**: Gemini answers in a dry, terse voice, with **Google Search** for news, prices, stock quotes, flight status and anything current. Falls back to Wikipedia/DuckDuckGo past the free search quota.
- **Hands-free**: "Jarvis, what's the weather?" works in one breath, or say "Jarvis" (or "OK Jarvis") and then your question. Don't say "Hey Jarvis": the glasses' own "Hey Even" wake word catches the "Hey E…" first and opens Even AI. Opt in on the phone; uses more battery and Groq quota (see below).
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
- **Memory**: "Jarvis, remember I parked on level 3." Recalled later; manage it on the phone.
- **Timers, reminders, notes, currency, weather**, with alerts on the glasses.
- **Dashboard**, **map**, **radar** ("find a cafe nearby"), **teleprompter**, **daily briefing**.
- **Protocols**: focus (Pomodoro), night (dim), stealth (minimal), standard. Plus a few undocumented ones.
- **Suit diagnostics**: glasses and phone battery, network, GPS, voice quota.
- **Personalities**: JARVIS (formal, British, the default), EDITH (dry, tactical) or FRIDAY (warm, Irish).
- **Phone mirror and remote**: a live copy of the HUD on the phone, with controls to drive the glasses while someone else wears them.
- **"What plane is that?"**: the aircraft closest to overhead, with flight, route, type, altitude and where to look. Runs through the Google Calendar script (ADS-B feeds only answer servers), so link the calendar first. **ISS passes**: when the space station next flies over and whether you'll see it.
- **Emergency protocol**: "Jarvis, emergency." Nearest A&E, pharmacy, police and defibrillator, the local emergency number, and a map link of where you are saved to notes. Press to walk to the A&E. The phone page has a **Share my location** button.
- **Heads-ups** (Jarvis speaks first): **rain** due in the next hour; **leave now** for events with a location, from the walking time; **pre-meeting briefs** with who's coming, where, and anything it remembers about them. Location and guests need the updated calendar script (re-deploy it from the phone page). Turn heads-ups off in Preferences.
- **Location reminders**: "remind me to buy batteries when I get to Tesco." **Pins**: "I parked here", then "take me back to the car". Pins drop automatically at the start of walks and navigation, so "take me back to where I started" just works.
- **Spending log**: "I spent £12 on lunch" logs instantly, even offline. Totals and CSV export on the phone.
- **Debrief**: "Jarvis, debrief" sums up the day: events, meetings, activity, spending, open lists, and tomorrow's first event.
- **Flashcards**: paste cards on the phone, or "make flashcards on French verbs". Press to flip, swipe for got it / again; spaced repetition brings cards back.
- **Voice-following teleprompter**: "voice teleprompter" turns the pages as you read aloud.
- **Speaking coach**: meeting summaries end with your pace, filler words and how much of the talking you did.
- **Smart home**: "Jarvis, lights off" through Home Assistant Cloud or IFTTT webhooks you add on the phone.
- **Backup and restore**: export everything to a file (API keys optional) and restore it on a new phone.
- **What's new**: shown once on the glasses after an update, or say "what's new".

### About hands-free

The glasses have no on-device wake word engine, so hands-free keeps the mic open while Jarvis is open on the glasses,
cuts out each phrase you say, and sends it to Groq Whisper to check whether it starts with "Jarvis" (or EDITH/FRIDAY).
Speech the Even app tags as someone else is skipped. Each check is one Groq request, so in a long conversation it can
use a good part of the free daily quota; Jarvis pauses hands-free at 95% and says so. It doesn't work while the app is
closed or in the background.

Everything uses free tiers or free public services. Bring your own keys: paste your Gemini and Groq API keys into the phone-side settings page. No keys are stored in this repo or the package.

*A fan project, not affiliated with Marvel or Stark Industries.* Map tiles © Esri, HERE, Garmin, © OpenStreetMap contributors. Places by Photon and Nominatim (OpenStreetMap). Walking routes by OSRM on FOSSGIS servers. Emergency services from OpenStreetMap via Overpass and Photon. Transit by Transitous. Weather by Open-Meteo. Crypto prices by CoinGecko. Scores from ESPN. Aircraft positions from adsb.lol (fetched by your calendar script), routes and types from adsbdb. ISS position from wheretheiss.at.

## Develop

```bash
npm install
npm run dev     # Vite dev server on your LAN
npm run sim     # in a second terminal: open the simulator
npm test        # unit tests (offline maths, expense parsing, flashcards, teleprompter, coach)
```

Opening the dev server in a normal browser also works: the phone page's mirror shows what the glasses would display.

## Package

```bash
npx evenhub login
npm run pack    # builds and writes jarvis.ehpk
npx evenhub upload jarvis.ehpk -m "what changed"
```
