/**
 * In-memory defer for pending streak USDT claim prompts.
 * Survives soft navigation within the same MiniPay session, but a fresh app
 * open clears it so unpaid D7/D14/… claims can surface again.
 */

const deferredWallets = new Set<string>();

function key(wallet: string): string {
  return wallet.toLowerCase();
}

export function hasDeferredStreakUsdtClaimPrompt(wallet: string): boolean {
  if (!wallet) return false;
  return deferredWallets.has(key(wallet));
}

export function deferStreakUsdtClaimPrompt(wallet: string): void {
  if (!wallet) return;
  deferredWallets.add(key(wallet));
}

export function clearDeferredStreakUsdtClaimPrompt(wallet: string): void {
  if (!wallet) return;
  deferredWallets.delete(key(wallet));
}
