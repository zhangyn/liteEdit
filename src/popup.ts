export interface PopupItem {
  label?: string
  sep?: boolean
  checked?: boolean
  disabled?: boolean
  action?: () => void
}

const layer = () => document.getElementById('popup-layer')!

function close() {
  const l = layer()
  l.classList.remove('visible')
  l.innerHTML = ''
  document.removeEventListener('mousedown', onDocDown, true)
}

function onDocDown(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (!target.closest('.popup-menu')) close()
}

/** 通用右键/下拉菜单(单层) */
export function showPopup(x: number, y: number, items: PopupItem[]) {
  const l = layer()
  l.innerHTML = ''
  const menu = document.createElement('div')
  menu.className = 'popup-menu'
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement('div')
      s.className = 'msep'
      menu.appendChild(s)
      continue
    }
    const el = document.createElement('div')
    el.className = 'mi' + (it.checked ? ' checked' : '') + (it.disabled ? ' disabled' : '')
    el.textContent = it.label!
    el.addEventListener('mousedown', (e) => e.stopPropagation())
    el.addEventListener('click', () => {
      close()
      it.action?.()
    })
    menu.appendChild(el)
  }
  // 必须先显示再测量:隐藏容器里量到的是 0×0,钳制会失效(菜单被窗口右缘裁掉)
  l.classList.add('visible')
  l.appendChild(menu)
  const rect = menu.getBoundingClientRect()
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + 'px'
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + 'px'
  document.addEventListener('mousedown', onDocDown, true)
}

export const closePopup = close
