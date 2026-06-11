"use client";

import { usePathname } from "next/navigation";
import MiniKitProvider from "@/components/MiniKitProvider";
import PlayerProfileProvider from "@/components/PlayerProfileProvider";

export default function AppProviders({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");

  if (isAdminRoute) {
    return <>{children}</>;
  }

  return (
    <MiniKitProvider>
      <PlayerProfileProvider>{children}</PlayerProfileProvider>
    </MiniKitProvider>
  );
}
