import { slugifyGameName } from "@/lib/game-assets";

/** Short gameplay lines for the Earn Daily list. Longer aliases win. */
const LINES: Array<[string, string]> = [
  ["retro-block", "Clear lines, earn rewards"],
  ["knockout", "Break blocks, win USDT"],
  ["knock-out", "Break blocks, win USDT"],
  ["reflector", "Aim, reflect, survive"],
  ["guardian", "Defend the galaxy"],
  ["free-fall", "Don't hit the walls"],
  ["freefall", "Don't hit the walls"],
  ["infinite", "Go deeper, earn more"],
  ["dot-connect", "Connect & clear"],
  ["dotconnect", "Connect & clear"],
  ["coin-sort", "Sort the coins, clear the board"],
  ["coinsort", "Sort the coins, clear the board"],
  ["coin", "Sort the coins, clear the board"],
  ["base-drop", "Drop the blocks, build the base"],
  ["basedrop", "Drop the blocks, build the base"],
  ["orbit-flow", "Stay on the path, keep the flow"],
  ["orbitflow", "Stay on the path, keep the flow"],
  ["orbit", "Stay on the path, keep the flow"],
  ["jelly", "Match the jellies, clear the stack"],
  ["hungry", "Feed the hole, grow it bigger"],
  ["hunger", "Feed the hole, grow it bigger"],
  ["fruit", "Swipe the fruit, keep the combo"],
  ["block-blast", "Blast blocks, open the board"],
  ["blockblast", "Blast blocks, open the board"],
  ["knife-throw", "Throw the knives, hit the target"],
  ["knifethrow", "Throw the knives, hit the target"],
];

const SORTED = [...LINES].sort((a, b) => b[0].length - a[0].length);

export function dailyEarnLine(gameName: string): string {
  const slug = slugifyGameName(gameName);
  for (const [alias, line] of SORTED) {
    if (slug === alias || slug.includes(alias)) return line;
  }
  return "Play a round, claim the reward";
}
