# EVEN JARVIS

A Jarvis-style AI assistant for Even Realities G2 glasses + R1 ring, built with the Even Hub SDK.

Bring your own keys: paste your Gemini and Groq API keys into the phone-side settings page. No keys are stored in this repo or the package.

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
npm run pack    # builds and writes even-jarvis.ehpk
```
