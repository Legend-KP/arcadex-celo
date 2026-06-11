import { SignJWT, importPKCS8 } from "jose";

const FIREBASE_SCOPES =
  "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database";

export function getProjectId(): string {
  return (
    process.env.FIREBASE_PROJECT_ID ??
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??
    ""
  );
}

export function getServiceAccount() {
  const projectId = getProjectId();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Server Firebase credentials missing. Add FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY as encrypted secrets in Cloudflare Worker settings, then redeploy."
    );
  }

  return { projectId, clientEmail, privateKey };
}

export function getDatabaseUrl(): string {
  const explicit = process.env.FIREBASE_DATABASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const projectId = getProjectId();
  if (!projectId) {
    throw new Error(
      "FIREBASE_DATABASE_URL or FIREBASE_PROJECT_ID is required for Realtime Database."
    );
  }

  return `https://${projectId}-default-rtdb.firebaseio.com`;
}

export async function getFirebaseAccessToken(): Promise<string> {
  const { clientEmail, privateKey } = getServiceAccount();
  const key = await importPKCS8(privateKey, "RS256");

  const assertion = await new SignJWT({ scope: FIREBASE_SCOPES })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(clientEmail)
    .setSubject(clientEmail)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error ?? "Could not obtain Google access token.");
  }

  return data.access_token;
}
