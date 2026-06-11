"use client";

import { usePathname } from "next/navigation";
import MiniPayProvider from "@/components/MiniPayProvider";
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
    <MiniPayProvider>
      <PlayerProfileProvider>{children}</PlayerProfileProvider>
    </MiniPayProvider>
  );
}
