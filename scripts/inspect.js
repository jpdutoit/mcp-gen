#!/usr/bin/env node

import { spawn } from "child_process";
import { resolve } from "path";

const serverPath = process.argv[2];

if (!serverPath) {
  console.error("Usage: pnpm run inspect <example-path>");
  console.error("Example: pnpm run inspect examples/math-tools/output");
  console.error("         pnpm run inspect examples/data-processor/output");
  process.exit(1);
}


let fullPath = resolve(process.cwd(), serverPath);
if (!fullPath.match(/\.m?js$/))
  fullPath = resolve(fullPath, "server.mjs")

console.log(`Inspecting: ${fullPath}`);

const child = spawn("npx", ["@modelcontextprotocol/inspector", "node", fullPath], {
  stdio: "inherit",
  shell: true,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
