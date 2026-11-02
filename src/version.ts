// Keep in step with package.json and app.json.
export const VERSION = '0.6.0'

/** Shown once on the glasses after an update, newest first. Short lines: it's a small screen. */
export const WHATS_NEW: Record<string, string[]> = {
  '0.6.0': [
    '"What plane is that?" and ISS passes',
    '"Emergency": nearest A&E, police, defib',
    'Rain, leave-now and pre-meeting alerts',
    '"Remind me when I get to..." and pins',
    '"Take me back to the car"',
    '"I spent £12 on lunch", "debrief"',
    'Flashcards and a voice-following teleprompter',
    'Speaking coach in meeting summaries',
    'Smart home webhooks, backup and restore',
  ],
}

export const whatsNew = (version = VERSION) => (WHATS_NEW[version] ?? []).map((l) => `· ${l}`).join('\n')
