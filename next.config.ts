import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  // Do not advertise the framework and version to every caller.
  poweredByHeader: false,
  outputFileTracingRoot: configDir,
  serverExternalPackages: [
    "undici",
    "web-push",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  // Next 16 blocks cross-origin access to dev resources by default. Allow the
  // loopback and the RFC1918 LAN ranges so the dev server stays reachable
  // from other machines on the same LAN.
  allowedDevOrigins: [
    "127.0.0.1",
    "10.*.*.*",
    // 172.16.0.0/12
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
    "192.168.*.*",
  ],
  async headers() {
    // Baseline hardening. Applied to every route, including static assets —
    // these are cheap and none of them depend on auth. Deliberately NOT a
    // strict Content-Security-Policy: this app relies on inline styles
    // throughout (React `style` props) and a nonce-based policy is a separate,
    // larger change. `frame-ancestors` is included because it is the
    // clickjacking control and does not affect the app's own rendering.
    const securityHeaders = [
      // Stop the browser guessing a content type it was not told.
      { key: "X-Content-Type-Options", value: "nosniff" },
      // Clickjacking: refuse to be framed at all. This UI can drive an agent,
      // so a hostile frame must never be able to overlay it.
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      // Never leak the URL (which can contain session ids) to third parties.
      { key: "Referrer-Policy", value: "no-referrer" },
      // The app needs none of these; deny by default.
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=()" },
    ];

    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
          ...securityHeaders,
        ],
      },
      {
        source: "/m",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
          ...securityHeaders,
        ],
      },
      // API responses must never be cached by a shared cache.
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          ...securityHeaders,
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          ...securityHeaders,
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          ...securityHeaders,
        ],
      },
      // Everything else (icons, offline page, static chunks) still gets the
      // baseline headers rather than none. `missing` would skip routes already
      // matched above, but Next applies all matching rules, so a plain catch-all
      // is correct here.
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
