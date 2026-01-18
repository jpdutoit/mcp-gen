#!/usr/bin/env node

import { spawn } from "child_process";

const tests = [
  { test: "examples/string-utils/test.yaml", server: "string-utils" },
  { test: "examples/async-api/test.yaml", server: "async-api" },
  { test: "examples/file-ops/test.yaml", server: "file-ops" },
  { test: "examples/data-processor/test.yaml", server: "data-processor" },
  { test: "examples/chrome-devtools/test.yaml", server: "chrome-devtools" },
];

const cwd = process.cwd();

async function runTest(test) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["mcp-server-tester", "tools", test.test, "--server-config", "server-config.json", "--server-name", test.server],
      { cwd, stdio: "inherit" }
    );

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Tests failed for ${test.server}`));
      }
    });
  });
}

async function main() {
  console.log("Running all example tests...\n");

  let failed = false;
  for (const test of tests) {
    console.log(`\n🧪 Testing ${test.server}...`);
    try {
      await runTest(test);
    } catch (error) {
      console.error(error.message);
      failed = true;
    }
  }

  if (failed) {
    console.log("\n❌ Some tests failed!");
    process.exit(1);
  }

  console.log("\n✅ All tests passed!");
}

main();
