import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
import {
  buildSessionCookie,
  createSessionValue,
  isValidSessionValue,
  readSessionCookie,
  sessionNeedsRenewal,
} from "@/lib/web-session";
import { loginUrlFor } from "@/lib/login-redirect";

function issueSession(response: NextResponse, password: string): NextResponse {
  // append, not set: Set-Cookie is multi-valued and other layers may add their own.
  response.headers.append("Set-Cookie", buildSessionCookie(createSessionValue(password)));
  return response;
}

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const password = process.env.PI_WEB_PASSWORD;
  if (!isWebPasswordEnabled(password)) return NextResponse.next();

  // 1. A valid signed session cookie is sufficient. It exists so the installed
  //    iOS PWA does not have to re-enter a password it cannot autofill.
  const cookieValue = readSessionCookie(request.headers.get("cookie"));
  if (isValidSessionValue(cookieValue, password)) {
    const response = NextResponse.next();
    // Renew well before the ceiling so ordinary daily use never re-prompts,
    // while an abandoned device still ages out.
    return sessionNeedsRenewal(cookieValue) ? issueSession(response, password) : response;
  }

  // 2. Otherwise Basic Auth — still supported for curl, scripts and first login.
  //    Success issues the cookie so the browser stops asking.
  if (isValidBasicAuthorization(request.headers.get("authorization"), password)) {
    return issueSession(NextResponse.next(), password);
  }

  // 3. Neither. For a browser navigation, send the user to the login FORM rather
  //    than returning a 401 challenge. An installed iOS PWA does not run the
  //    Basic Auth challenge handler — the home-screen app rendered the 401 body
  //    ("Authentication required") with no prompt, while Safari prompted
  //    normally. A form works in both and is what iOS Keychain can autofill.
  //
  //    Non-navigation requests (fetch/XHR, the API, scripts) still get a proper
  //    401 with the challenge, so curl and programmatic clients are unaffected.
  const wantsDocument = request.headers.get("sec-fetch-dest") === "document";
  if (!isApiRequest && wantsDocument) {
    const target = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    // The Location header must be ABSOLUTE here: NextResponse rejects a bare
    // path with "TypeError: Invalid URL" (found by running it, not by reading).
    const location = new URL(loginUrlFor(target), request.nextUrl.origin);
    return NextResponse.redirect(location, 303);
  }

  // 4. Reject. `Vary` keeps caches from serving one identity's response to
  //    another.
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      Vary: "Authorization, Cookie",
      "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
    },
  });
}

// `"/"` alone matches ONLY the root path — it is not a prefix match. `/m` (the
// mobile surface) therefore has to be listed explicitly, or the mobile shell is
// served unauthenticated while `/` and `/api/*` stay protected.
//
// `/login` is deliberately absent: the form must be reachable while
// unauthenticated, and `/login/submit` verifies the password itself.
export const config = { matcher: ["/", "/m", "/api/:path*"] };
