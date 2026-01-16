#!/usr/bin/env node

import { Command } from "commander";
import { resolve, basename } from "path";
import { tmpdir } from "os";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { spawn } from "child_process";
import { generateMcpServer } from "./generator.js";

const program = new Command();

program
  .name("mcp-gen")
  .description("Generate MCP servers from TypeScript files")
  .version("1.0.0");

program
  .argument("<entry>", "TypeScript entry file path")
  .option("-o, --output <dir>", "Output directory", "./mcp-server")
  .option("-n, --name <name>", "Server name (defaults to filename)")
  .option("-r, --run", "Compile to temp folder and run immediately")
  .action(async (entry: string, options: { output: string; name?: string; run?: boolean }) => {
    const entryPath = resolve(process.cwd(), entry);

    if (options.run) {
      // Create temp directory and run
      const tempDir = await mkdtemp(join(tmpdir(), "mcp-gen-"));

      try {
        await generateMcpServer({
          entryPath,
          outputDir: tempDir,
          serverName: options.name,
        });

        const serverPath = join(tempDir, "server.mjs");

        // Spawn the server process, inheriting stdio for interactive use
        const child = spawn("node", [serverPath], {
          stdio: "inherit",
        });

        // Handle cleanup on exit
        const cleanup = async () => {
          child.kill();
          await rm(tempDir, { recursive: true, force: true });
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        child.on("exit", async (code) => {
          await rm(tempDir, { recursive: true, force: true });
          process.exit(code ?? 0);
        });
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true });
        console.error("Error:", error);
        process.exit(1);
      }
    } else {
      // Normal generation mode
      const outputDir = resolve(process.cwd(), options.output);

      try {
        await generateMcpServer({
          entryPath,
          outputDir,
          serverName: options.name,
        });
        console.log(`MCP server generated successfully in ${outputDir}`);
      } catch (error) {
        console.error("Error generating MCP server:", error);
        process.exit(1);
      }
    }
  });

if (process.argv.length <= 2) {
  program.help();
} else {
  program.parse();
}
