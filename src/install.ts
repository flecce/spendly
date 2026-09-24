/**
 * "Install the app" on phones. Android/Chromium hands us an install prompt
 * (beforeinstallprompt), which must be caught early; iOS has no API, so there we
 * explain the Share → Add to Home Screen steps instead.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
let installed = false;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // keep the browser's own mini-infobar away; we offer it from settings
  deferred = e as InstallPromptEvent;
});
window.addEventListener('appinstalled', () => {
  installed = true;
  deferred = null;
});

const ua = navigator.userAgent;
// iPadOS reports itself as a Mac, but has touch.
export const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isMobile = isIos || /Android|Mobi/i.test(ua);

const isStandalone = (): boolean =>
  matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Worth offering: on a phone or tablet, in the browser, not already installed. */
export const canOfferInstall = (): boolean => isMobile && !installed && !isStandalone();

/** Shows the browser's install prompt. Returns false when there is none (manual steps needed). */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null; // a prompt can only be used once
  await e.prompt();
  if ((await e.userChoice).outcome === 'accepted') installed = true;
  return true;
}
