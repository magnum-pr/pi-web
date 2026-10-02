import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { isMobileUserAgent } from "@/lib/mobile-ua";

export default async function Home() {
  // Phones belong on the mobile surface (`app/m`). Detection is by user agent,
  // not viewport, so a narrowed desktop window still gets the desktop UI.
  const userAgent = (await headers()).get("user-agent");
  if (isMobileUserAgent(userAgent)) redirect("/m");

  return (
    <Suspense>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
