import {
  waitForEvenAppBridge,
  CreateStartUpPageContainer,
  TextContainerProperty,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

const status = document.getElementById('status')!

const bridge = await waitForEvenAppBridge()
status.textContent = 'Bridge ready.'

// Step 1 placeholder: one full-screen text container that captures input.
// The HUD frame and boot sequence replace this in step 2.
const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [
      new TextContainerProperty({
        xPosition: 0,
        yPosition: 0,
        width: 576,
        height: 288,
        borderWidth: 1,
        borderColor: 5,
        borderRadius: 6,
        paddingLength: 12,
        containerID: 1,
        containerName: 'main',
        content: 'J.A.R.V.I.S // ONLINE\n\nDouble press to exit.',
        isEventCapture: 1,
      }),
    ],
  }),
)

if (result !== 0) {
  status.textContent = `createStartUpPageContainer failed: ${result}`
}

bridge.onEvenHubEvent((event) => {
  // Gestures can arrive on textEvent or sysEvent (the simulator uses sysEvent).
  const type = event.textEvent?.eventType ?? event.sysEvent?.eventType
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    // Mode 1 shows the system exit dialog (required on the root page).
    bridge.shutDownPageContainer(1)
  }
})
