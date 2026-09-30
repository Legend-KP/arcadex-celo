export type RewardPayout = {
  address: string;
  amount: number;
};

/** Static payout rows shown on the Home winners strip. */
export const REWARD_PAYOUTS: RewardPayout[] = [
  // Group A — 5 × $1
  { address: "0xd36b1E310fc3D31C3A340829057EcF2d593e4d35", amount: 1 },
  { address: "0x94Be4A948F12882c3b22a24a3107eA18CeA3170E", amount: 1 },
  { address: "0xD5eCcfA0a0Bad3119d1741fEe3CE885052383315", amount: 1 },
  { address: "0xd880Fee20DB55Db09b81dDDB57210193482ab981", amount: 1 },
  { address: "0x0DC2aaCcd1FFea164BdEbE1441451922f77E72e1", amount: 1 },

  // Group B — 10 × $0.5
  { address: "0xB1A66E28B141223559E2eB9D2b22B23AfFc19C20", amount: 0.5 },
  { address: "0x9A2d468c18c5C9b335b973CCA2bf92aCF3e1B91b", amount: 0.5 },
  { address: "0x5406f45150cc5004a426778ffa8Fa7F6ab4ae432", amount: 0.5 },
  { address: "0xd36b1E310fc3D31C3A340829057EcF2d593e4d35", amount: 0.5 },
  { address: "0x97A504FE9D80e59681885F6606aC96807d9C5c0b", amount: 0.5 },
  { address: "0x25de23a9aB9E3abB23Fb38B66C05824b1cEb1Cb0", amount: 0.5 },
  { address: "0x7d61a0dCEc6722F89594aC2e1f2BB7dD274354F5", amount: 0.5 },
  { address: "0xebaf830b2a442934d86e74FA43eb24Ee5814fE70", amount: 0.5 },
  { address: "0x3256515d0C57833A000A71ABd73b72b10fB74a98", amount: 0.5 },
  { address: "0x379645d65215D1b96AF4458E2ba4ade921D5d7B5", amount: 0.5 },

  // Group C — 5 × $0.5
  { address: "0xebaf830b2a442934d86e74FA43eb24Ee5814fE70", amount: 0.5 },
  { address: "0x8f429178bF5766150e114528adeb138cd9AA3E31", amount: 0.5 },
  { address: "0xd36b1E310fc3D31C3A340829057EcF2d593e4d35", amount: 0.5 },
  { address: "0x65da1b1e533fD488be6C8EeEDF9674139B6F7972", amount: 0.5 },
  { address: "0x91e9A43d6Cf3E08c13f7e16cE737f490629A5fa9", amount: 0.5 },

  // Group D — screen leaderboard 10 × $1
  { address: "0x379645d65215D1b96AF4458E2ba4ade921D5d7B5", amount: 1 },
  { address: "0x3256515d0C57833A000A71ABd73b72b10fB74a98", amount: 1 },
  { address: "0xd52c26b6F03A0b004b48506E9D2498D0019CDFE8", amount: 1 },
  { address: "0x3455421B6E0593ec33640FdF88D7ee62F41E5658", amount: 1 },
  { address: "0x8f429178bF5766150e114528adeb138cd9AA3E31", amount: 1 },
  { address: "0x1b299E548b0157BA9bAd8B497ca84f33A938a4F5", amount: 1 },
  { address: "0x9bd29FA680AAcc987fdCdfBffCc51f66967a15B8", amount: 1 },
  { address: "0x25de23a9aB9E3abb23Fb38B66C05824b1cEb1Cb0", amount: 1 },
  { address: "0x65da1b1e533fD488be6C8EeEDF9674139B6F7972", amount: 1 },
  { address: "0xd36b1E310fc3D31C3A340829057EcF2d593e4d35", amount: 1 },
];

/** `0x` + first 3 + `…` + last 3 */
export function truncateRewardAddress(address: string): string {
  if (address.length < 8) return address;
  return `${address.slice(0, 5)}…${address.slice(-3)}`;
}

export function formatRewardAmount(amount: number): string {
  return `$${amount}`;
}
