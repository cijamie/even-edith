# EVEN EDITH

**E.D.I.T.H.** (Even Dead, I'm The Hero): a Stark-style AI assistant for Even Realities G2 glasses + R1 ring, built with the Even Hub SDK.

Hold the ring, talk, and EDITH answers on the HUD. She can also run timers, reminders, a calendar, notes, weather, currency conversion, and a dashboard ("EDITH, open dashboard").

Bring your own keys: paste your Gemini and Groq API keys into the phone-side settings page. No keys are stored in this repo or the package.

*A fan project, not affiliated with Marvel or Stark Industries.*

## Develop

```bash
npm install
npm run dev     # Vite dev server on your LAN
npm run sim     # in a second terminal: open the simulator
```

On the phone (Developer Mode on): `npx evenhub qr --url http://<your-pc-lan-ip>:5173`, then scan in the Even Hub tab.

## Package

```bash
npx evenhub login
npm run pack    # builds and writes even-edith.ehpk
npx evenhub upload even-edith.ehpk -m "what changed"
```
