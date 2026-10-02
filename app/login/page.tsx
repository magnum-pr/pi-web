import { safeNextPath } from "@/lib/login-redirect";
import { isWebPasswordEnabled, PI_WEB_AUTH_USERNAME } from "@/lib/web-auth";
import { redirect } from "next/navigation";

/**
 * Password form.
 *
 * Deliberately a plain server-rendered `<form method="post">` — no client JS, no
 * fetch. That means it works identically in Safari and in an **installed iOS
 * PWA**, and it is a real form for **iOS Keychain to autofill and offer to
 * save**. (HTTP Basic Auth works in neither: a standalone PWA does not run the
 * challenge handler, which is why the home-screen app only ever showed
 * "Authentication required".)
 */
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const failed = params.error === "invalid";

  // Nothing to log into — never show a form that cannot succeed.
  if (!isWebPasswordEnabled()) redirect("/");

  return (
    <main
      style={{
        minHeight: "var(--app-viewport-height, 100dvh)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px calc(24px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left))",
        background: "var(--bg)",
      }}
    >
      <form
        method="post"
        action="/login/submit"
        data-login-form="true"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%",
          maxWidth: 320,
          padding: 20,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 14,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, letterSpacing: "-0.01em" }}>Pi Web</h1>

        <input type="hidden" name="next" value={next} />
        {/* Hidden username so Keychain associates the saved password with the
            login rather than an anonymous field. */}
        <input
          type="text"
          name="username"
          autoComplete="username"
          defaultValue={PI_WEB_AUTH_USERNAME}
          readOnly
          aria-label="Username"
          style={{
            height: 44,
            padding: "0 12px",
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            color: "var(--text-dim)",
            // 16px minimum stops iOS zooming the page on focus.
            fontSize: 16,
          }}
        />

        <input
          type="password"
          name="password"
          autoComplete="current-password"
          autoFocus
          required
          placeholder="Password"
          aria-label="Password"
          aria-invalid={failed || undefined}
          style={{
            height: 44,
            padding: "0 12px",
            background: "var(--bg)",
            border: `1px solid ${failed ? "#e01a4f" : "var(--border)"}`,
            borderRadius: 10,
            color: "var(--text)",
            fontSize: 16,
          }}
        />

        {failed && (
          <p role="alert" data-login-error="true" style={{ margin: 0, fontSize: 13, color: "#e01a4f" }}>
            Incorrect password. Try again.
          </p>
        )}

        <button
          type="submit"
          style={{
            height: 44,
            background: "var(--accent)",
            border: "none",
            borderRadius: 10,
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
