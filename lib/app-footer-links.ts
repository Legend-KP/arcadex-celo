export const LEGAL_BASE_URL = "https://privacy-policy-one-ashy.vercel.app";
export const PRIVACY_POLICY_URL = `${LEGAL_BASE_URL}/privacy-policy`;
export const TERMS_URL = `${LEGAL_BASE_URL}/terms-and-conditions`;
export const SUPPORT_URL = "https://t.me/+70wfO-Phan5jYjJl";

export type FaqItem = {
  question: string;
  answer: string;
};

export const ARCADEX_FAQS: FaqItem[] = [
  {
    question: "What is ArcadeX?",
    answer:
      "ArcadeX is your Web3 game hub inside MiniPay. Browse games from the home screen, spend a Spark to enter any game, and play as much as you want during that session.",
  },
  {
    question: "How do I start playing?",
    answer:
      "Open ArcadeX in MiniPay, pick a game from the home screen, and tap Start Game. You need at least one Spark (or active Infinite Spark) and a connected wallet to begin.",
  },
  {
    question: "Do I need a wallet?",
    answer:
      "Yes. ArcadeX runs inside MiniPay, so your wallet connects automatically. Your wallet is used for Sparks, score submissions, and on-chain rewards.",
  },
  {
    question: "What is my player name?",
    answer:
      "When you first open ArcadeX, you choose a display name. That name appears on leaderboards across all games, so pick something you are happy to be seen with.",
  },
  {
    question: "What are Sparks?",
    answer:
      "Sparks are your game-entry passes. Each Spark lets you start one game session. Once you are inside a game, you can play freely for that session.",
  },
  {
    question: "How do Sparks refill?",
    answer:
      "You start with up to 3 Sparks. Each empty slot refills automatically over 3 hours. Tap the Spark bar in the top-right to see your refill timers.",
  },
  {
    question: "What if I run out of Sparks?",
    answer:
      "You can wait for Sparks to regenerate, buy a Spark Refill for $0.05 to fill your bar instantly, or buy Infinite Spark for $0.10 to play any game freely for 24 hours.",
  },
  {
    question: "Is Infinite Spark a subscription?",
    answer:
      "No. Infinite Spark is a one-time 24-hour purchase. It removes the Spark entry cost only — leaderboard rules and contest rules still apply.",
  },
  {
    question: "Is there a daily check-in?",
    answer:
      "Yes. ArcadeX includes a daily check-in streak. Check in each day to build your streak and earn rewards, including bonus Sparks at milestone days.",
  },
  {
    question: "Is there a tutorial for each game?",
    answer:
      "Many games show a quick how-to-play tutorial the first time you open them. You can also tap the info (i) button on a game's menu screen to view it again.",
  },
  {
    question: "How do leaderboards work?",
    answer:
      "Games with leaderboards track your personal best locally. To appear on the public leaderboard, submit your score from inside the game and approve the small on-chain payment in MiniPay.",
  },
  {
    question: "How much does it cost to submit a score?",
    answer:
      "Submitting a score to the leaderboard costs $0.05 (paid in USDT or USDC through MiniPay). Your personal best is saved even if you choose not to submit.",
  },
  {
    question: "How do contests work?",
    answer:
      "When a contest is live, you will see a Contest is Live banner on the game menu and a countdown on that game's leaderboard. Contest duration, reward pool details, and how prizes are distributed are shown on the leaderboard for that game.",
  },
  {
    question: "Where do contest rewards come from?",
    answer:
      "Contest rewards are paid from the reward pool built by player score-submission fees for that contest. How the pool is split among winners is described on the game's leaderboard.",
  },
  {
    question: "Can I play without paying?",
    answer:
      "Yes. You can use free Sparks that regenerate over time and play without buying refills. Optional purchases — Spark Refill, Infinite Spark, and leaderboard submissions — are only there if you want faster access or to compete publicly.",
  },
  {
    question: "Why are some games marked Coming Soon?",
    answer:
      "Games that are not live yet appear on the home screen but cannot be started. Check back later — new titles are added regularly.",
  },
  {
    question: "How do I get help?",
    answer:
      "Tap Support below to join the Trenchverse community on Telegram. Our team and other players can help with wallet, Spark, leaderboard, and contest questions.",
  },
];
