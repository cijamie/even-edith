# EVEN EDITH

**E.D.I.T.H.** (Even Dead, I'm The Hero): a Stark-style AI assistant for Even Realities G2 glasses + R1 ring, built with the Even Hub SDK.

Hold the ring, talk, and EDITH answers on the HUD.

## What she does

- **Ask anything**: Gemini answers in a dry, terse voice; Wikipedia/DuckDuckGo lookups for facts.
- **Memory**: "EDITH, remember I parked on level 3." Facts get a category; short-lived ones expire on their own. Manage them on the phone.
- **Timers, reminders, calendar, notes, currency, weather**, with alerts on the glasses.
- **Repeating and place reminders**: "every weekday at 8", "next time I pass a pharmacy", "when I get to the office".
- **Lists**: "add eggs to my shopping list", "tick off milk"; tick and edit them on the phone.
- **Walking directions**: "take me to the British Museum", "take me home", or "take me to number 2" after a radar. The route on the map, the next turn in the panel, automatic rerouting. "Cycle to…" and "drive to…" work too.
- **News**: "news" or "tech news" for headlines (Wikipedia's In the news, Hacker News); Gemini can also search the past week of Hacker News stories.
- **Sun, moon and air**: sunrise, sunset, UV, air quality and the moon phase, on the dashboard and in the briefing.
- **Calculator and unit conversion**: "15% of 84", "5 miles in km", "100°F in celsius". Worked out on the phone, instantly.
- **Flashcards**: "make me 15 Spanish food flashcards", then "study flashcards". Press to reveal, swipe up if you knew it, down if not; spaced repetition decides when each card comes back.
- **Proactive alerts**: rain about to start, place reminders, your shopping list when you pass a supermarket.
- **Notification relay**: send chosen phone notifications to EDITH through ntfy.sh (free and hosted, nothing to run). Ask "any messages?" to hear them again.
- **Offline fallback**: if Gemini can't be reached or is rate limited, timers, "remind me in…", notes, lists, memory, sums, conversions and the time still work.
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

*A fan project, not affiliated with Marvel or Stark Industries.* Map tiles © Esri, HERE, Garmin, © OpenStreetMap contributors. Places by Photon and Nominatim (OpenStreetMap). Routes by OSRM on FOSSGIS servers. Weather and air quality by Open-Meteo. News from Wikipedia and Hacker News. Relay by ntfy.sh.

## Notification relay

EDITH can't read phone notifications directly: the Even Hub SDK doesn't expose them. (The Even app already mirrors your phone's standard notifications to the glasses.) The relay is for routing chosen ones *into EDITH*:

1. In the phone app, open **Alerts and notifications** and press **Turn on**. You get a private `https://ntfy.sh/edith-…` URL. Keep it secret: anyone with it can post to you.
2. Point an automation at it with an HTTP POST. The body is the message; a `Title` header (or `?title=`) is the sender.
   - **Android**: MacroDroid or Tasker, trigger "Notification received" (pick the apps), action "HTTP request".
   - **iOS**: Shortcuts > Automation (e.g. "When I get a message from…"), action "Get Contents of URL", method POST.
   - Anything else that can call a webhook (IFTTT, Home Assistant, GitHub Actions) works the same way.
3. EDITH checks every 20 seconds while she's open on the glasses. During focus protocol, messages are held quietly.

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
