import type { Metadata } from "next";
import "./globals.css";
import AppProviders from "@/components/AppProviders";
import { readFirebaseConfigFromEnv } from "@/lib/firebase-config";
import { readWorldAppConfigFromEnv } from "@/lib/world-app-config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ArcadeX",
  description: "Play fun mini-games on ArcadeX",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const firebaseConfig = readFirebaseConfigFromEnv();
  const worldAppConfig = readWorldAppConfigFromEnv();
  const configScript = `window.__FIREBASE_CONFIG__=${JSON.stringify(firebaseConfig).replace(/</g, "\\u003c")};window.__WORLD_APP_CONFIG__=${JSON.stringify(worldAppConfig).replace(/</g, "\\u003c")};`;

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: configScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
