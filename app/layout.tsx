import type { Metadata } from "next";
import "./globals.css";
import AppProviders from "@/components/AppProviders";
import { readFirebaseConfigFromEnv } from "@/lib/firebase-config";

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
  const configScript = `window.__FIREBASE_CONFIG__=${JSON.stringify(firebaseConfig).replace(/</g, "\\u003c")};`;

  return (
    <html lang="en">
      <head>
        <meta
          name="talentapp:project_verification"
          content="f3b290721b9a4b2e4b52379318c76d26d86afee32afe305a88ccf663d82fb467cf59bee03daefe681a30732b9063d09a0c08285a83a53fd0634a81aa5fe2480e"
        />
        <script dangerouslySetInnerHTML={{ __html: configScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
