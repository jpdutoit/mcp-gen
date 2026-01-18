#!/usr/bin/env node

import { spawn } from "child_process";
import { resolve } from "path";

const examples = [
  { entry: "string-utils/index.ts", output: "string-utils/output", name: "string-utils" },
  { entry: "async-api/index.ts", output: "async-api/output", name: "async-api" },
  { entry: "file-ops/index.ts", output: "file-ops/output", name: "file-ops" },
  { entry: "data-processor/index.ts", output: "data-processor/output", name: "data-processor" },
  { entry: "data-processor/validators.ts", output: "data-processor/validators-output", name: "validators" },
  { entry: "chrome-devtools/index.ts", output: "chrome-devtools/output", name: "chrome-devtools" },
];

const cwd = process.cwd();

async function buildExample(example) {
  const entryPath = resolve(cwd, "examples", example.entry);
  const outputPath = resolve(cwd, "examples", example.output);

  return new Promise((resolve, reject) => {
    const child = spawn("node", ["dist/mcp-gen.js", entryPath, "-o", outputPath, "-n", example.name], {
      cwd,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Failed to build ${example.name}`));
      }
    });
  });
}

async function main() {
  console.log("Building all examples...\n");

  for (const example of examples) {
    console.log(`\n📦 Building ${example.name}...`);
    try {
      await buildExample(example);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }

  console.log("\n✅ All examples built successfully!");
}

main();
