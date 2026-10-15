/**
 * Minimal npm shim — portable Node on this machine is missing real npm.
 * Supports: `npm run build` and `npm exec wrangler ...`
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const nodeExe = "E:\\kushal paliwal\\node.exe";
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const wranglerBin = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

const args = process.argv.slice(2);

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    cwd: root,
    env: process.env,
    shell: false,
    ...opts,
  });
  process.exit(result.status ?? 1);
}

if (args[0] === "run" && args[1] === "build") {
  run(nodeExe, [nextBin, "build"]);
}

if (args[0] === "exec" && args[1] === "wrangler") {
  const wranglerArgs = args.slice(2).filter((a) => a !== "--");
  // Flatten accidental "--env production" single tokens into separate flags.
  const flat = [];
  for (const a of wranglerArgs) {
    if (a.startsWith("--") && a.includes(" ")) {
      const [flag, ...rest] = a.split(" ");
      flat.push(flag, rest.join(" "));
    } else {
      flat.push(a);
    }
  }
  run(nodeExe, [wranglerBin, ...flat], {
    env: {
      ...process.env,
      OPEN_NEXT_DEPLOY: process.env.OPEN_NEXT_DEPLOY || "true",
    },
  });
}

if (args[0] === "--version" || args[0] === "-v") {
  process.stdout.write("10.9.2-shim\n");
  process.exit(0);
}

console.error("[deploy-shim] unsupported:", args.join(" "));
process.exit(1);
