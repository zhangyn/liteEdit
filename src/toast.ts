let timer: ReturnType<typeof setTimeout> | undefined

export function toast(msg: string, ms = 2500) {
  const el = document.getElementById('toast')!
  el.textContent = msg
  el.classList.add('visible')
  clearTimeout(timer)
  timer = setTimeout(() => el.classList.remove('visible'), ms)
}
