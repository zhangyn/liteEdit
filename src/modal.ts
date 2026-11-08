/** 应用内模态对话框(原生 dialog 不支持三按钮,自绘统一主题) */

function build(msg: string, buttons: { label: string; primary?: boolean; value: string }[]): Promise<string> {
  return new Promise((resolve) => {
    const layer = document.getElementById('modal-layer')!
    layer.innerHTML = ''
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    const box = document.createElement('div')
    box.className = 'modal-box'
    const p = document.createElement('div')
    p.className = 'modal-msg'
    p.textContent = msg
    const btns = document.createElement('div')
    btns.className = 'modal-btns'
    for (const b of buttons) {
      const el = document.createElement('button')
      el.textContent = b.label
      if (b.primary) el.classList.add('primary')
      el.addEventListener('click', () => {
        layer.classList.remove('visible')
        layer.innerHTML = ''
        resolve(b.value)
      })
      btns.appendChild(el)
    }
    box.append(p, btns)
    mask.appendChild(box)
    layer.appendChild(mask)
    layer.classList.add('visible')
  })
}

export function confirmModal(msg: string, okLabel = '确定'): Promise<boolean> {
  return build(msg, [
    { label: '取消', value: 'cancel' },
    { label: okLabel, primary: true, value: 'ok' },
  ]).then((v) => v === 'ok')
}

/** 保存 / 不保存 / 取消 三选一 */
export function confirm3(msg: string): Promise<'save' | 'discard' | 'cancel'> {
  return build(msg, [
    { label: '取消', value: 'cancel' },
    { label: '不保存', value: 'discard' },
    { label: '保存', primary: true, value: 'save' },
  ]).then((v) => v as 'save' | 'discard' | 'cancel')
}
