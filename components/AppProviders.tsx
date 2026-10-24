"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import MiniPayProvider from "@/components/MiniPayProvider";
import PlayerProfileProvider from "@/components/PlayerProfileProvider";
import SparkProvider from "@/components/SparkProvider";
import TouchSfxListener from "@/components/TouchSfxListener";
import { releaseStuckDocumentScroll } from "@/lib/use-body-scroll-lock";

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);
  const isAdminRoute = pathname?.startsWith("/admin");

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname ?? null;
    const leftGame =
      Boolean(previous?.startsWith("/game/")) &&
      !pathname?.startsWith("/game/");
    // After a fullscreen game, MiniPay can leave the menu unable to scroll
    // even though the game layer is gone. Clear that whenever we return.
    releaseStuckDocumentScroll({ thaw: leftGame });
  }, [pathname]);

  if (isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <MiniPayProvider>
      <PlayerProfileProvider>
        <SparkProvider>
          <TouchSfxListener />
          {children}
        </SparkProvider>
      </PlayerProfileProvider>
    </MiniPayProvider>
  );
}
