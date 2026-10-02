/**
 * True when `bytes` starts with a RIFF/WAVE header.
 *
 * Lives in `lib/` rather than the route module: Next.js generates route types
 * that only permit HTTP-verb exports plus a small allowlist, so any other
 * export from an `app/**\/route.ts` fails the production build's type check.
 */
export function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // "WAVE"
  );
}
