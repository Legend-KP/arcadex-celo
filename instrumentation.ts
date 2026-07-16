export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge middleware must stay lightweight; full secret assert runs on Node/Worker handlers.
    return;
  }

  try {
    const { assertRequiredSecrets } = await import("@/lib/required-secrets");
    assertRequiredSecrets();
  } catch (err) {
    // Surface clearly in Worker/logs; production routes still fail closed via requireWalletAuth.
    console.error(
      "[ArcadeX] Startup secret check failed:",
      err instanceof Error ? err.message : err
    );
    if (process.env.NODE_ENV === "production") {
      throw err;
    }
  }
}
