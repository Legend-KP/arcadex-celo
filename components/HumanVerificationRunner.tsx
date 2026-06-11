"use client";

import { useEffect, useRef, useState } from "react";
import type { IDKitResult, RpContext } from "@worldcoin/idkit-core";
import { useIDKitRequest, orbLegacy } from "@worldcoin/idkit";
import { MiniKit } from "@worldcoin/minikit-js";
import { PlayerProfile } from "@/types";

const VERIFY_SESSION_KEY = "arcadex_human_verify_attempted";

interface HumanVerificationFlowProps {
  walletAddress: string;
  appId: string;
  action: string;
  rpContext: RpContext;
  onVerified: (user: PlayerProfile) => void;
}

function HumanVerificationFlow({
  walletAddress,
  appId,
  action,
  rpContext,
  onVerified,
}: HumanVerificationFlowProps) {
  const submittedRef = useRef(false);
  const openedRef = useRef(false);

  const flow = useIDKitRequest({
    app_id: appId as `app_${string}`,
    action,
    rp_context: rpContext,
    allow_legacy_proofs: true,
    preset: orbLegacy({ signal: walletAddress }),
  });

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    flow.open();
  }, [flow]);

  useEffect(() => {
    if (!flow.isSuccess || !flow.result || submittedRef.current) return;
    submittedRef.current = true;

    void (async () => {
      try {
        const res = await fetch("/api/verify/proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress,
            idkitResponse: flow.result as IDKitResult,
          }),
        });
        const data = (await res.json()) as {
          user?: PlayerProfile;
          error?: string;
        };
        if (res.ok && data.user) {
          onVerified(data.user);
        }
      } catch {
        // Verification is optional — fail silently
      }
    })();
  }, [flow.isSuccess, flow.result, walletAddress, onVerified]);

  return null;
}

interface HumanVerificationRunnerProps {
  walletAddress: string;
  isHumanVerified: boolean;
  isReady: boolean;
  /** Block World ID overlay while the name modal is open (IDKit z-index blocks touches). */
  blocked?: boolean;
  onVerified: (user: PlayerProfile) => void;
}

export default function HumanVerificationRunner({
  walletAddress,
  isHumanVerified,
  isReady,
  blocked = false,
  onVerified,
}: HumanVerificationRunnerProps) {
  const [config, setConfig] = useState<{
    app_id: string;
    action: string;
    rp_context: RpContext;
  } | null>(null);

  useEffect(() => {
    if (blocked) {
      setConfig(null);
      return;
    }
    if (!isReady || !walletAddress || isHumanVerified) return;
    if (!MiniKit.isInstalled()) return;
    if (sessionStorage.getItem(VERIFY_SESSION_KEY)) return;

    sessionStorage.setItem(VERIFY_SESSION_KEY, "1");

    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/verify/init", { method: "POST" });
        const data = (await res.json()) as {
          app_id?: string;
          action?: string;
          rp_context?: RpContext;
          error?: string;
        };
        if (!cancelled && res.ok && data.app_id && data.action && data.rp_context) {
          setConfig({
            app_id: data.app_id,
            action: data.action,
            rp_context: data.rp_context,
          });
        }
      } catch {
        // World ID not configured or unavailable — skip silently
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blocked, isReady, walletAddress, isHumanVerified]);

  if (blocked || !config || !walletAddress || isHumanVerified) return null;

  return (
    <HumanVerificationFlow
      walletAddress={walletAddress}
      appId={config.app_id}
      action={config.action}
      rpContext={config.rp_context}
      onVerified={onVerified}
    />
  );
}
