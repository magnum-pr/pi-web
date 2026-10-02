/**
 * Phone/tablet detection for the `/` → `/m` redirect.
 *
 * Deliberately USER-AGENT based, not viewport based. A width check
 * (`max-width: 640px`) would also capture a narrowed desktop window and bounce
 * the owner off the desktop UI, which was an explicit non-goal. The UA only
 * changes with the device.
 *
 * iPadOS 13+ reports itself as `Macintosh` in its desktop-mode UA, so the
 * `Macintosh` + `Mobile` combination is the documented tell.
 */
const PHONE_UA = /iPhone|iPod|Android.*Mobile|Windows Phone/i;
const TABLET_UA = /iPad|Android(?!.*Mobile)/i;

export function isMobileUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  if (/Macintosh/i.test(userAgent) && /Mobile/i.test(userAgent)) return true; // iPadOS desktop-mode UA
  return PHONE_UA.test(userAgent) || TABLET_UA.test(userAgent);
}
