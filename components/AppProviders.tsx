"use client";

import { usePathname } from "next/navigation";
import MiniPayProvider from "@/components/MiniPayProvider";
import PlayerProfileProvider from "@/components/PlayerProfileProvider";
import SparkProvider from "@/components/SparkProvider";

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
      <PlayerProfileProvider>
        <SparkProvider>{children}</SparkProvider>
      </PlayerProfileProvider>
    </MiniPayProvider>
  );
}
