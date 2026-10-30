import { CHECKS, runCheck } from '../net/diagnostics'
import type { Settings } from '../settings'

/** Connection test: runs each API check in order and shows pass/fail. */
export function mountDiagnostics(root: HTMLElement, settings: Settings) {
  root.innerHTML = `
    <ul class="checks">
      ${CHECKS.map(
        (c) => `
        <li data-id="${c.id}">
          <span class="dot" aria-hidden="true"></span>
          <div class="check-text">
            <div class="check-head"><span>${c.label}</span><span class="verdict">—</span></div>
            <div class="check-detail"></div>
          </div>
        </li>`,
      ).join('')}
    </ul>
    <div class="actions"><button type="button" class="primary run">Run test</button></div>
    <p class="msg summary" role="status"></p>`

  const run = root.querySelector<HTMLButtonElement>('.run')!
  const summary = root.querySelector('.summary')!

  run.addEventListener('click', async () => {
    run.disabled = true
    summary.textContent = ''
    let passed = 0
    for (const check of CHECKS) {
      const li = root.querySelector<HTMLElement>(`[data-id="${check.id}"]`)!
      const verdict = li.querySelector('.verdict')!
      const detail = li.querySelector('.check-detail')!
      li.dataset.state = 'running'
      verdict.textContent = '…'
      detail.textContent = ''
      const r = await runCheck(check, settings)
      li.dataset.state = r.ok ? 'pass' : 'fail'
      verdict.textContent = r.ok ? `${r.verdict} · ${r.ms} ms` : r.verdict
      detail.textContent = r.detail
      if (r.ok) passed++
    }
    summary.textContent = `${passed}/${CHECKS.length} passed`
    summary.className = `msg summary ${passed === CHECKS.length ? 'ok' : 'warn'}`
    run.disabled = false
    run.textContent = 'Run again'
  })
}
