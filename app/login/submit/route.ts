import { NextResponse } from "next/server";

import { isValidBasicAuthorization, isWebPasswordEnabled } from "@/lib/web-auth";
import { safeNextPath } from "@/lib/login-redirect";
import { buildSessionCookie, createSessionValue } from "@/lib/web-session";

/**
 * Password login as a normal form POST.
 *
 * Why a form and not HTTP Basic Auth: an **installed iOS PWA does not run the
 * Basic Auth challenge handler**. The home-screen app rendered the 401 body
 * ("Authentication required") with no prompt, while Safari — which handles the
 * top-level navigation itself — prompted normally.
 *
 * A form is ordinary HTML, so it works in both, and it is the shape **iOS
 * Keychain can autofill and offer to save**, which was the owner's original
 * complaint about the installed app having no password manager.
 *
 * The credential check is not reimplemented: the submitted fields are turned
 * back into a `Basic` header and passed to `isValidBasicAuthorization`, so there
 * is exactly one password comparison in the codebase.
 */
export async function POST(request: Request) {
  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) {
    // No password configured — nothing to log into.
    return redirectTo(request, "/");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirectToLogin(request, "/", "invalid");
  }

  const username = String(form.get("username") ?? "");
  const suppliedPassword = String(form.get("password") ?? "");
  const next = safeNextPath(form.get("next"));

  const header = `Basic ${Buffer.from(`${username}:${suppliedPassword}`, "utf8").toString("base64")}`;
  if (!isValidBasicAuthorization(header, password)) {
    return redirectToLogin(request, next, "invalid");
  }

  const response = redirectTo(request, next);
  response.headers.append("Set-Cookie", buildSessionCookie(createSessionValue(password)));
  return response;
}

/**
 * 303 to a same-origin path.
 *
 * The Location must be ABSOLUTE: NextResponse rejects a bare path with
 * "TypeError: Invalid URL" (found by running it, not by reading).
 */
function redirectTo(request: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, new URL(request.url).origin), 303);
}

function redirectToLogin(request: Request, next: string, error?: string): NextResponse {
  const params = new URLSearchParams();
  if (next !== "/") params.set("next", next);
  if (error) params.set("error", error);
  const qs = params.toString();
  return redirectTo(request, qs ? `/login?${qs}` : "/login");
}
