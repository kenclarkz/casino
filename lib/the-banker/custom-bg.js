// Optional custom phone background support.
// Drop an image at assets/custom/phone-bg.(jpg|jpeg|png|webp) and every
// phone-facing page (/ and /play) uses it as its full-screen backdrop.

const BASE = new URL('../../assets/custom/phone-bg', import.meta.url)
const EXTS = ['jpg', 'jpeg', 'png', 'webp']

export function applyCustomPhoneBg() {
  const tryExt = i => {
    if (i >= EXTS.length) return
    const url = `${BASE.href}.${EXTS[i]}`
    const img = new Image()
    img.onload = () => {
      // dark scrim keeps the UI readable over any photo
      document.body.style.backgroundImage =
        `radial-gradient(1200px 700px at 50% -10%, rgba(246,201,69,.10), transparent 60%),` +
        `linear-gradient(180deg, rgba(18,11,38,.72), rgba(7,5,14,.82)), url("${url}")`
      document.body.classList.add('custom-phone-bg')
    }
    img.onerror = () => tryExt(i + 1)
    img.src = url
  }
  tryExt(0)
}
