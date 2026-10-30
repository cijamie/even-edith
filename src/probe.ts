import {
  CreateStartUpPageContainer,
  TextContainerProperty,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

/**
 * Glyph probe: load with ?probe to check which characters the glasses font
 * renders, and how wide they are. Run it on hardware before trusting a glyph.
 */
export async function runProbe(bridge: EvenAppBridge) {
  const lines = [
    '0 ╭──╮ ╰──╯ │ ─',
    '1 ┌──┐ └──┘ ├ ┤',
    '2 ▁▂▃▄▅▆▇█ ░▒▓',
    '3 ● ○ ◆ ◇ ▸ ▹ ► ·',
    '4 ⟨ ⟩ « » ‹ › ⌐ ¬',
    '5 iiiiiiiiii|',
    '6 MMMMMMMMMM|',
    '7 ──────────|',
    '8 ··········|',
  ]
  if (new URLSearchParams(location.search).get('probe') === 'space') {
    lines.length = 0
    lines.push('──╮', ' │', '  │', '   │', '    │', '     │', '──────────|', '          |')
  }
  await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 5,
      textObject: [
        text(1, 'probe', 0, 0, 576, 288, lines.join('\n'), 4, 1),
        text(2, 'c0', 400, 0, 176, 30, 'textColor 0', 0),
        text(3, 'c1', 400, 30, 176, 30, 'textColor 1', 1),
        text(4, 'c2', 400, 60, 176, 30, 'textColor 2', 2),
        text(5, 'c3', 400, 90, 176, 30, 'textColor 3', 3),
      ],
    }),
  )
}

function text(
  containerID: number,
  containerName: string,
  xPosition: number,
  yPosition: number,
  width: number,
  height: number,
  content: string,
  textColor: number,
  isEventCapture = 0,
) {
  return new TextContainerProperty({
    containerID,
    containerName,
    xPosition,
    yPosition,
    width,
    height,
    content,
    textColor,
    isEventCapture,
    borderWidth: 0,
    paddingLength: 0,
  })
}
