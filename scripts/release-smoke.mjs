#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const smokeArgs = process.argv.slice(2).filter((argument) => argument !== "--");
const tarball = smokeArgs.find((argument) => !argument.startsWith("--"));
if (!tarball || !fs.existsSync(path.resolve(tarball))) {
  throw new Error("Usage: node scripts/release-smoke.mjs <product-tarball>");
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "vibekit-release-smoke-"));
const home = path.join(root, "home");
const prefix = path.join(root, "prefix");
const project = path.join(root, "my-agent");
fs.mkdirSync(home, { recursive: true });

const inheritedPath = (process.env.PATH ?? "/usr/bin:/bin")
  .split(path.delimiter)
  .filter((entry) => !fs.existsSync(path.join(entry, "vibekit")) && !fs.existsSync(path.join(entry, "vibekit.cmd")));
const env = {
  ...process.env,
  HOME: home,
  PATH: [path.join(prefix, "bin"), ...inheritedPath].join(path.delimiter),
};
for (const secret of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "BRAVE_API_KEY", "TAVILY_API_KEY", "TELEGRAM_BOT_TOKEN"]) {
  delete env[secret];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, env, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status) => {
      if (status !== 0) {
        reject(new Error(`${command} ${args.join(" ")} failed with exit ${status}\n${stdout}${stderr}`));
      } else {
        resolve({ stdout, stderr, status });
      }
    });
  });
}

try {
  run("npm", ["install", "--prefix", prefix, "--global", "--ignore-scripts", path.resolve(tarball)]);
  const command = path.join(prefix, "bin", "vibekit");
  if (!fs.existsSync(command)) throw new Error(`The packed product did not leave a durable vibekit command at ${command}`);
  const version = run(command, ["--version"]);
  if (!/^\d+\.\d+\.\d+\s*$/m.test(version.stdout)) {
    throw new Error(`vibekit --version did not report a release version: ${version.stdout}`);
  }

  const created = run(command, ["create", "my-agent", "--provider", "openai", "--model", "gpt-5", "--yes"], { cwd: root });
  if (!created.stdout.includes("Created VibeKit Project") || !created.stdout.includes("doctor: ok")) {
    throw new Error(`The packed quickstart did not complete readiness:\n${created.stdout}${created.stderr}`);
  }
  if (created.stdout.indexOf("Created VibeKit Project") < created.stdout.indexOf("doctor: ok")) {
    throw new Error("Create printed Created before the readiness report");
  }
  for (const forbidden of ["package.json", "package-lock.json", "pnpm-lock.yaml", "node_modules"]) {
    if (fs.existsSync(path.join(project, forbidden))) {
      throw new Error(`Default Project unexpectedly created ${forbidden}; bundled runtime should load once from the product`);
    }
  }

  const cliEntry = fs.realpathSync(command);
  const productRoot = path.resolve(path.dirname(cliEntry), "..");
  for (const required of [
    path.join(productRoot, "registry", "index.json"),
    path.join(productRoot, "schemas", "project.schema.json"),
    path.join(productRoot, "dist", "internal", "host", "index.js"),
    path.join(productRoot, "dist", "internal", "host", "main.js"),
    path.join(productRoot, "dist", "internal", "interfaces", "terminal", "index.js"),
    path.join(productRoot, "dist", "internal", "interfaces", "telegram", "index.js"),
    path.join(productRoot, "dist", "internal", "pi", "index.js"),
    path.join(productRoot, "dist", "internal", "state", "memory", "index.js"),
    path.join(productRoot, "dist", "internal", "tools", "web", "index.js"),
  ]) {
    if (!fs.existsSync(required)) throw new Error(`Packed product is missing required artifact ${required}`);
  }
  const firstPartyRoot = path.join(productRoot, "node_modules", "@useagentsio");
  if (fs.existsSync(firstPartyRoot)) throw new Error(`Packed product contains an obsolete first-party dependency tree at ${firstPartyRoot}`);

  const packedReadme = path.join(productRoot, "README.md");
  if (fs.existsSync(packedReadme)) {
    const readme = fs.readFileSync(packedReadme, "utf8");
    for (const commandText of [
      "vibekit create my-agent --provider openai --model gpt-5 --yes",
      "vibekit msg \"Hello! What can you help me with?\"",
    ]) {
      if (!readme.includes(commandText)) throw new Error(`Packed README is missing the tested canonical command: ${commandText}`);
    }
  }

  const { VibeKitHost } = await import(pathToFileURL(path.join(productRoot, "dist", "internal", "host", "index.js")).href);
  const host = await VibeKitHost.start({
    projectRoot: project,
    startInterfaces: true,
    runTurn: async (request) => ({
      text: "controlled provider response",
      cancelled: false,
      events: [],
      sessionPath: request.conversation.sessionPath,
    }),
  });
  try {
    const result = await runAsync(command, ["msg", "Hello! What can you help me with?"], { cwd: project });
    if (!result.stdout.includes("controlled provider response")) {
      throw new Error(`Packed CLI returned an unexpected controlled response:\n${result.stdout}${result.stderr}`);
    }
  } finally {
    await host.stop();
  }

  console.log(`Release smoke passed for ${path.resolve(tarball)}`);
  console.log(`Clean HOME: ${home}`);
  console.log(`Install prefix: ${prefix}`);
  console.log(`Project: ${project}`);
  if (!process.argv.includes("--keep")) {
    fs.rmSync(root, { recursive: true, force: true });
    console.log("Temporary clean-home, prefix, and Project state removed.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Smoke artifacts retained at ${root}`);
  process.exitCode = 1;
}
