import { waitForEvenAppBridge, OsEventTypeList } from '@evenrealities/even_hub_sdk'
import { runProbe } from './probe'
import { Display } from './hud/display'
import { createHud, ID, NAMES } from './hud/layout'
import { boot } from './hud/boot'
import { typewrite, type Typing } from './hud/typewriter'
import { paginate } from './hud/paginate'

const status = document.getElementById('status')!

const bridge = await waitForEvenAppBridge()
status.textContent = 'Bridge ready.'

if (new URLSearchParams(location.search).has('probe')) {
  await runProbe(bridge)
} else {
  await startHud()
}

async function startHud() {
  await createHud(bridge)
  const display = new Display(bridge, NAMES)

  // Step 2 demo: press shows a long sample answer, swipes page through it.
  // Ring-to-talk replaces this in step 5.
  const SAMPLE =
    'Certainly, sir. The forecast calls for light rain from 3pm, clearing by evening. ' +
    'I would suggest the umbrella, though I suspect you will ignore me as usual. ' +
    'Your next appointment is at 4:30, a call with the design team. ' +
    'You have two unread messages, neither of which appears urgent, ' +
    'and one reminder to buy coffee, which I would classify as critical. ' +
    'Traffic on your usual route is light. Battery levels are nominal. ' +
    'Shall I read the messages, or would you prefer to remain blissfully unaware?'

  let ready = false
  let pages: string[] = []
  let page = 0
  let typing: Typing | null = null

  const footer = () =>
    display.set(ID.footer, pages.length > 1 ? `PAGE ${page + 1}/${pages.length} · SWIPE` : 'PRESS · ASK')

  const showPage = async (n: number) => {
    typing?.skip()
    page = n
    void footer()
    const t = typewrite(display, ID.body, pages[page])
    typing = t
    await t.done
    if (typing === t) typing = null
  }

  bridge.onEvenHubEvent((event) => {
    if (!ready) return
    // Gestures can arrive on textEvent or sysEvent (the simulator uses sysEvent),
    // and CLICK_EVENT (0) is often dropped, leaving eventType undefined.
    const src = event.textEvent ?? event.sysEvent
    if (!src) return
    const type = src.eventType ?? OsEventTypeList.CLICK_EVENT
    switch (type) {
      case OsEventTypeList.CLICK_EVENT:
        if (typing) {
          // Press while typing finishes the reveal instantly.
          const t = typing
          typing = null
          t.skip()
        } else {
          pages = paginate(SAMPLE)
          void showPage(0)
        }
        break
      case OsEventTypeList.SCROLL_BOTTOM_EVENT:
        if (page < pages.length - 1) void showPage(page + 1)
        break
      case OsEventTypeList.SCROLL_TOP_EVENT:
        if (page > 0) void showPage(page - 1)
        break
      case OsEventTypeList.DOUBLE_CLICK_EVENT:
        // Mode 1 shows the system exit dialog (required on the root page).
        bridge.shutDownPageContainer(1)
        break
    }
  })

  await boot(display)
  await display.set(ID.footer, 'PRESS · ASK')
  ready = true
}
