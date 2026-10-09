import type { Abi, Address, Hash } from "viem";

/** Contract labels matching the Dune query. */
export type ContractLabel =
  | "ArcadeXTxHub"
  | "ArcadeXRewards"
  | "SparkRefill"
  | "ScoreSubmit"
  | "InfiniteSpark";

export const ARCADEX_TX_HUB =
  "0x7D0fc71785B25d7878f83c4bf0E125DD89470FEc" as Address;
export const ARCADEX_REWARDS =
  "0xc5BE4773D5B4a8e3C6f3E7a4C5f7cfBC38986ccF" as Address;
export const SPARK_REFILL =
  "0xD7EA6F0212b5b54a9fA4fc2d805CE63426A48B18" as Address;
export const SCORE_SUBMIT =
  "0x7EE96ddeabB9a7A93cd4A66A32aC45622028555F" as Address;
export const INFINITE_SPARK =
  "0x2a9f38b41035a900d5038D1972955011fb3278E7" as Address;

export const CELO_USDT =
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e" as Address;
export const CELO_USDC =
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C" as Address;

/** Skip dust transfers below $0.05 (6 decimals) — same as Dune. */
export const MIN_TRANSFER_VALUE = 50_000n;

export const PAYMENT_CONTRACTS: Record<string, ContractLabel> = {
  [SPARK_REFILL.toLowerCase()]: "SparkRefill",
  [SCORE_SUBMIT.toLowerCase()]: "ScoreSubmit",
  [INFINITE_SPARK.toLowerCase()]: "InfiniteSpark",
};

/** Deploy txs used to resolve the earliest start block on first sync. */
export const DEPLOY_TX_HASHES: Hash[] = [
  "0x7a9f03c05425a05f12025849574f27f9f78140e16b99a48d1abd187a173691c8", // InfiniteSpark
  "0xfbf7324d83242659bd4b8935a514a11edd166156e7e2dbcaa226f7e7a31389c9", // SparkRefill
  "0x1ef9051ef7c51509cafa1d7b7d52cc01e096560f8d5a5ae1114a266eca4757ed", // ScoreSubmit
  "0x29c50a08895c0c9702393faf370049f899a170b1407ed8cd8c5f67dbaa9a540f", // ArcadeXRewards
  "0x23bea549a481bfe7669c1dd0e5957d8f22ce45303b07aba48ee9ca1f905aceea", // ArcadeXTxHub
];

export const TX_HUB_EVENTS_ABI = [
  {
    type: "event",
    name: "SignedIn",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: true, name: "purpose", type: "bytes32" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "EntryPaid",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: true, name: "purpose", type: "bytes32" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
] as const satisfies Abi;

export const REWARDS_EVENTS_ABI = [
  {
    type: "event",
    name: "CheckedIn",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: true, name: "campaignId", type: "uint256" },
      { indexed: false, name: "day", type: "uint16" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "SpinResultGranted",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: true, name: "campaignId", type: "uint256" },
      { indexed: false, name: "rewardMode", type: "uint8" },
      { indexed: false, name: "rewardTarget", type: "address" },
      { indexed: false, name: "rewardAmount", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "OnChainRewardClaimed",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: true, name: "campaignId", type: "uint256" },
      { indexed: false, name: "rewardMode", type: "uint8" },
      { indexed: false, name: "rewardTarget", type: "address" },
      { indexed: false, name: "rewardAmount", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
] as const satisfies Abi;

export const ENTRY_PAID_ABI = [
  {
    type: "event",
    name: "EntryPaid",
    inputs: [
      { indexed: true, name: "player", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
  },
] as const satisfies Abi;

export const ERC20_TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const satisfies Abi;
