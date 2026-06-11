export type WorldAppPublicConfig = {
  appId: string;
};

export function readWorldAppConfigFromEnv(): WorldAppPublicConfig {
  return {
    appId:
      process.env.NEXT_PUBLIC_APP_ID?.trim() ||
      process.env.NEXT_PUBLIC_WORLD_APP_ID?.trim() ||
      process.env.APP_ID?.trim() ||
      process.env.WORLD_APP_ID?.trim() ||
      "",
  };
}

export function getWorldAppPublicConfig(): WorldAppPublicConfig {
  if (typeof window !== "undefined" && window.__WORLD_APP_CONFIG__) {
    return window.__WORLD_APP_CONFIG__;
  }
  return readWorldAppConfigFromEnv();
}

declare global {
  interface Window {
    __WORLD_APP_CONFIG__?: WorldAppPublicConfig;
  }
}

export {};
