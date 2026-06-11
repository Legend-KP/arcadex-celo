export type FirebasePublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export function readFirebaseConfigFromEnv(): FirebasePublicConfig {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
  };
}

export function getFirebasePublicConfig(): FirebasePublicConfig {
  if (typeof window !== "undefined" && window.__FIREBASE_CONFIG__) {
    return window.__FIREBASE_CONFIG__;
  }
  return readFirebaseConfigFromEnv();
}

export function assertFirebaseConfig(
  config: FirebasePublicConfig
): asserts config is FirebasePublicConfig & { projectId: string } {
  const missing = (
    [
      ["NEXT_PUBLIC_FIREBASE_API_KEY", config.apiKey],
      ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", config.authDomain],
      ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", config.projectId],
      ["NEXT_PUBLIC_FIREBASE_APP_ID", config.appId],
    ] as const
  ).filter(([, value]) => !value);

  if (missing.length > 0) {
    const keys = missing.map(([key]) => key).join(", ");
    throw new Error(
      `Firebase is not configured (${keys}). Add these in Cloudflare Worker → Settings → Variables, then redeploy.`
    );
  }
}

declare global {
  interface Window {
    __FIREBASE_CONFIG__?: FirebasePublicConfig;
  }
}

export {};
