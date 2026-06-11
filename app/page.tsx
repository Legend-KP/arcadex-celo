"use client";

import dynamic from "next/dynamic";
import LoadingScreen from "@/components/LoadingScreen";

const HomePage = dynamic(() => import("@/components/HomePage"), {
  ssr: false,
  loading: () => <LoadingScreen />,
});

export default function Page() {
  return <HomePage />;
}
