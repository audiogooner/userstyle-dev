#!/usr/bin/env node
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { scaffold } from "./scaffold.mjs";

const help = `create-userstyle <dir> --origin <url> --name <style name>

  --id <id>          site id (default: first hostname label)
  --author <name>    UserStyle author
  --port <number>    dev server port (default: 3847)
`;

function parseArgs(argv) {
  const args = {
    dir: null,
    origin: null,
    name: null,
    id: null,
    author: "",
    port: 3847,
    help: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--origin") {
      args.origin = argv[++i];
    } else if (arg === "--name") {
      args.name = argv[++i];
    } else if (arg === "--id") {
      args.id = argv[++i];
    } else if (arg === "--author") {
      args.author = argv[++i] || "";
    } else if (arg === "--port") {
      args.port = Number(argv[++i]);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  args.dir = positional[0] || null;
  return args;
}

async function promptMissing(args) {
  if (args.origin && args.name && args.dir) {
    return args;
  }
  if (!stdin.isTTY) {
    throw new Error("Pass <dir> --origin <url> --name <style name>");
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!args.dir) {
      args.dir = (await rl.question("Directory: ")).trim();
    }
    if (!args.name) {
      args.name = (await rl.question("Style name: ")).trim();
    }
    if (!args.origin) {
      args.origin = (await rl.question("Site origin: ")).trim();
    }
  } finally {
    rl.close();
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(help);
  process.exit(0);
}

try {
  await promptMissing(args);
  if (!args.dir || !args.origin || !args.name) {
    throw new Error("Directory, origin, and name are required");
  }
  const dir = resolve(args.dir);
  await scaffold({
    dir,
    origin: args.origin,
    name: args.name,
    id: args.id,
    author: args.author,
    port: args.port,
  });
  console.log(`Created ${dir}`);
  console.log("Next: cd into it, npm install, npm run dev");
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
