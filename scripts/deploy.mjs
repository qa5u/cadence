import { existsSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";

const envFile = ".env.local";
const backup = ".env.local.deploy-backup";

if (existsSync(backup)) {
  if (existsSync(envFile)) {
    throw new Error("Both .env.local and .env.local.deploy-backup exist. Resolve manually.");
  }
  renameSync(backup, envFile);
}

const hidden = existsSync(envFile);
if (hidden) renameSync(envFile, backup);

let status = 1;

const run = (command) =>
  spawnSync("pnpm", ["exec", "opennextjs-cloudflare", command], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

try {
  const build = run("build");
  if (build.status === 0) {
    const deploy = run("deploy");
    status = deploy.status ?? 1;
  } else {
    status = build.status ?? 1;
  }
} finally {
  if (existsSync(backup)) renameSync(backup, envFile);
}

process.exit(status);
