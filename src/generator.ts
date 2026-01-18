import { mkdir, writeFile, cp, rm, readFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";
import { execSync } from "child_process";
import { parseTypeScriptFile, ToolDefinition, PromptDefinition, ResourceDefinition, ToolParameter, OutputSchema, OutputSchemaProperty } from "./parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GeneratorOptions {
  entryPath: string;
  outputDir: string;
  serverName?: string;
  /** Use stderr for output (required when stdout is reserved for stdio transport) */
  useStderr?: boolean;
}

function paramToZodType(param: ToolParameter): string {
  const baseType = (() => {
    switch (param.type) {
      case "number":
        return "z.number()";
      case "boolean":
        return "z.boolean()";
      case "array":
        return "z.array(z.unknown())";
      case "object":
        return "z.object({})";
      default:
        return "z.string()";
    }
  })();

  const withDescription = param.description
    ? `${baseType}.describe(${JSON.stringify(param.description)})`
    : baseType;

  return param.required ? withDescription : `${withDescription}.optional()`;
}

function generateZodSchema(parameters: ToolParameter[]): string {
  if (parameters.length === 0) {
    return "{}";
  }

  const schemaEntries = parameters
    .map((p) => `    ${p.name}: ${paramToZodType(p)}`)
    .join(",\n");

  return `{\n${schemaEntries}\n  }`;
}

function outputSchemaToZod(schema: OutputSchema, indent: number = 0): string {
  const pad = "  ".repeat(indent);

  switch (schema.type) {
    case "string":
      return "z.string()";
    case "number":
      return "z.number()";
    case "boolean":
      return "z.boolean()";
    case "array":
      if (schema.items) {
        return `z.array(${outputSchemaToZod(schema.items, indent)})`;
      }
      return "z.array(z.unknown())";
    case "record":
      if (schema.valueType) {
        return `z.record(z.string(), ${outputSchemaToZod(schema.valueType, indent)})`;
      }
      return "z.record(z.string(), z.unknown())";
    case "object":
      if (schema.properties && schema.properties.length > 0) {
        const props = schema.properties
          .map((p) => {
            const propSchema = outputSchemaPropertyToZod(p, indent + 1);
            return `${pad}    ${p.name}: ${propSchema}`;
          })
          .join(",\n");
        return `z.object({\n${props}\n${pad}  })`;
      }
      return "z.object({})";
    default:
      return "z.unknown()";
  }
}

function outputSchemaPropertyToZod(prop: OutputSchemaProperty, indent: number): string {
  let zodType: string;

  switch (prop.type) {
    case "string":
      zodType = "z.string()";
      break;
    case "number":
      zodType = "z.number()";
      break;
    case "boolean":
      zodType = "z.boolean()";
      break;
    case "array":
      if (prop.items) {
        zodType = `z.array(${outputSchemaToZod(prop.items, indent)})`;
      } else {
        zodType = "z.array(z.unknown())";
      }
      break;
    case "object":
      if (prop.properties && prop.properties.length > 0) {
        const pad = "  ".repeat(indent);
        const nestedProps = prop.properties
          .map((p) => {
            const nestedSchema = outputSchemaPropertyToZod(p, indent + 1);
            return `${pad}    ${p.name}: ${nestedSchema}`;
          })
          .join(",\n");
        zodType = `z.object({\n${nestedProps}\n${pad}  })`;
      } else {
        zodType = "z.object({})";
      }
      break;
    default:
      zodType = "z.unknown()";
  }

  return prop.optional ? `${zodType}.optional()` : zodType;
}

function generateCapabilities(resources: ResourceDefinition[]): string {
  const hasSubscribableResources = resources.some((r) => r.subscribeType);

  if (!hasSubscribableResources) {
    return "";
  }

  return `, {
    capabilities: {
      resources: {
        subscribe: true,
      },
    },
  }`;
}

function generateServerCode(
  tools: ToolDefinition[],
  prompts: PromptDefinition[],
  resources: ResourceDefinition[],
  serverName: string
): string {
  const allImports = [
    ...tools.map((t) => t.name),
    ...prompts.map((p) => p.name),
    ...resources.map((r) => r.name),
  ];
  const importStatement = allImports.length > 0
    ? `import { ${allImports.join(", ")} } from "./tools.mjs";`
    : "";

  const toolRegistrations = tools
    .map((tool) => {
      const zodSchema = generateZodSchema(tool.parameters);
      const paramNames = tool.parameters.map((p) => p.name);
      const argsDestructure =
        paramNames.length > 0 ? `const { ${paramNames.join(", ")} } = args;` : "";
      const callArgs = paramNames.join(", ");

      // Generate outputSchema for objects and arrays (arrays are wrapped in {results: []})
      const hasOutputSchema = tool.outputSchema && (tool.outputSchema.type === "object" || tool.outputSchema.type === "array");
      const isArrayOutput = tool.outputSchema?.type === "array";

      // Check if the return type is a CallToolResult (has a 'content' array property)
      const isCallToolResult = tool.outputSchema?.type === "object" &&
        tool.outputSchema.properties?.some(p => p.name === "content" && p.type === "array");

      let outputSchemaStr: string;
      if (isCallToolResult) {
        // Don't add outputSchema for CallToolResult - it's passed through directly
        outputSchemaStr = "";
      } else if (hasOutputSchema) {
        if (isArrayOutput) {
          // Wrap array in object: { results: array }
          outputSchemaStr = `,\n      outputSchema: z.object({ results: ${outputSchemaToZod(tool.outputSchema!, 3)} })`;
        } else {
          outputSchemaStr = `,\n      outputSchema: ${outputSchemaToZod(tool.outputSchema!, 3)}`;
        }
      } else {
        outputSchemaStr = "";
      }

      // Generate the return statement based on whether we have outputSchema
      let returnStatement: string;
      if (isCallToolResult) {
        // Pass through CallToolResult directly (cast for type safety)
        returnStatement = `return result as CallToolResult;`;
      } else if (hasOutputSchema) {
        if (isArrayOutput) {
          // Wrap array result in { results: [] }
          returnStatement = `return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: { results: result },
      };`;
        } else {
          // Return structuredContent for objects
          returnStatement = `return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };`;
        }
      } else {
        // Return text content for primitives (string, number, boolean)
        returnStatement = `return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result),
          },
        ],
      };`;
      }

      return `
  server.registerTool(
    "${tool.name}",
    {
      description: ${JSON.stringify(tool.description)},
      inputSchema: ${zodSchema}${outputSchemaStr},
    },
    async (args) => {
      ${argsDestructure}
      const result = await ${tool.name}(${callArgs});
      ${returnStatement}
    }
  );`;
    })
    .join("\n");

  const promptRegistrations = prompts
    .map((prompt) => {
      const zodSchema = generateZodSchema(prompt.parameters);
      const paramNames = prompt.parameters.map((p) => p.name);
      const argsDestructure =
        paramNames.length > 0 ? `const { ${paramNames.join(", ")} } = args;` : "";
      const callArgs = paramNames.join(", ");
      return `
  server.registerPrompt(
    "${prompt.name}",
    {
      description: ${JSON.stringify(prompt.description)},
      argsSchema: ${zodSchema},
    },
    async (args) => {
      ${argsDestructure}
      const result = await ${prompt.name}(${callArgs});
      // Support both string returns and GetPromptResult-style objects
      if (typeof result === "string") {
        return GetPromptResultSchema.parse({
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: result,
              },
            },
          ],
        });
      }
      return GetPromptResultSchema.parse(result);
    }
  );`;
    })
    .join("\n");

  const resourceRegistrations = resources
    .map((resource) => {
      const hasParams = resource.parameters.length > 0;
      const paramNames = resource.parameters.map((p) => p.name);
      const defaultMimeType = resource.mimeType ? JSON.stringify(resource.mimeType) : `"text/plain"`;

      // Build the read callback using the helper function
      let readCallback: string;
      if (hasParams) {
        const argsExtract = paramNames.map((p) => `const ${p} = variables.${p} as string;`).join("\n      ");
        readCallback = `async (uri, variables) => {
      ${argsExtract}
      return __parseResourceResult(await ${resource.name}(${paramNames.join(", ")}), uri.href, ${defaultMimeType});
    }`;
      } else {
        readCallback = `async (uri) => {
      return __parseResourceResult(await ${resource.name}(), uri.href, ${defaultMimeType});
    }`;
      }

      // URI is already in {param} format for MCP
      const mcpUri = resource.uri;

      // Use ResourceTemplate for templated URIs
      let uriArg: string;
      if (hasParams) {
        if (resource.hasList) {
          const listCallback = `async () => {
        const items = await ${resource.name}.list();
        return { resources: items.map((item: any) => __parseListItem(item, ${defaultMimeType})) };
      }`;
          uriArg = `new ResourceTemplate("${mcpUri}", { list: ${listCallback} })`;
        } else {
          uriArg = `new ResourceTemplate("${mcpUri}", { list: undefined })`;
        }
      } else {
        uriArg = `"${mcpUri}"`;
      }

      return `
  server.registerResource(
    "${resource.name}",
    ${uriArg},
    {
      description: ${JSON.stringify(resource.description)},
    },
    ${readCallback}
  );`;
    })
    .join("\n");

  const capabilities = generateCapabilities(resources);

  // Generate subscription handling code
  const hasSubscriptions = resources.some((r) => r.subscribeType);
  const subscriptionImports = hasSubscriptions
    ? `\nimport { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";`
    : "";

  // Generate subscription handlers
  const subscribableResources = resources.filter((r) => r.subscribeType);

  // Generate the subscribe matching logic
  // Both helpers take functions that can be called repeatedly in a loop
  const subscribeMatches = subscribableResources.map((r) => {
    const isTemplated = r.parameters.length > 0;
    const helper = r.subscribeType === "generator" ? "__generatorSubscription" : "__asyncSubscription";
    if (isTemplated) {
      return `  {
    const match = new UriTemplate("${r.uri}").match(uri);
    if (match) return ${helper}(uri, () => ${r.name}.subscribe(match));
  }`;
    } else {
      return `  if (uri === "${r.uri}") return ${helper}(uri, () => ${r.name}.subscribe());`;
    }
  }).join("\n");

  const hasTemplatedResources = resources.some((r) => r.parameters.length > 0);
  const hasTemplatedSubscriptions = subscribableResources.some((r) => r.parameters.length > 0);

  // Import ResourceTemplate for resource registration, UriTemplate for subscription matching
  let resourceTemplateImport = "";
  if (hasTemplatedResources) {
    resourceTemplateImport = `\nimport { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";`;
  }
  const uriTemplateImport = hasTemplatedSubscriptions
    ? `\nimport { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";`
    : "";

  const hasPrompts = prompts.length > 0;
  const promptTypeImport = hasPrompts
    ? `\nimport { GetPromptResultSchema } from "@modelcontextprotocol/sdk/types.js";`
    : "";

  const hasResources = resources.length > 0;
  const hasListResources = resources.some((r) => r.hasList);

  // Build types imports from MCP SDK
  const typesImports: string[] = [];
  if (hasResources) {
    typesImports.push("TextResourceContentsSchema", "BlobResourceContentsSchema", "ReadResourceResultSchema");
  }
  if (hasListResources) {
    typesImports.push("ResourceSchema");
  }
  const resourceSchemaImport = typesImports.length > 0
    ? `\nimport { ${typesImports.join(", ")} } from "@modelcontextprotocol/sdk/types.js";`
    : "";

  // Helper functions injected when resources are used
  const resourceHelpers = hasResources ? `
// Helper: Parse resource result into ReadResourceResult format
function __parseResourceResult(
  result: string | { text: string; mimeType?: string } | { blob: string; mimeType?: string } | { contents: any[] },
  uri: string,
  defaultMimeType: string
) {
  if (typeof result === "string") {
    return { contents: [TextResourceContentsSchema.parse({ uri, mimeType: defaultMimeType, text: result })] };
  }
  if ("contents" in result) {
    return ReadResourceResultSchema.parse(result);
  }
  if ("blob" in result) {
    return { contents: [BlobResourceContentsSchema.parse({ uri, mimeType: result.mimeType ?? defaultMimeType, blob: result.blob })] };
  }
  return { contents: [TextResourceContentsSchema.parse({ uri, mimeType: result.mimeType ?? defaultMimeType, text: result.text })] };
}
` : "";

  const listHelpers = hasListResources ? `
// Helper: Parse list item into Resource format
function __parseListItem(item: string | { uri: string; name?: string; mimeType?: string }, defaultMimeType: string) {
  const getName = (uri: string) => uri.split("/").pop() || uri;
  if (typeof item === "string") {
    return { uri: item, name: getName(item), mimeType: defaultMimeType };
  }
  const data = ResourceSchema.parse(item);
  return { ...data, name: data.name ?? getName(data.uri), mimeType: data.mimeType ?? defaultMimeType };
}
` : "";

  // Subscription helpers go inside getServer since they have per-instance state
  const subscriptionHelpersInner = hasSubscriptions
    ? `
  // Subscription state management (per-server instance)
  const __subscriptions = new Map<string, { stop: boolean }>();

  async function __notifyUpdated(uri: string, state: { stop: boolean }): Promise<boolean> {
    try {
      await server.server.notification({ method: "notifications/resources/updated", params: { uri } });
      return true;
    } catch {
      // Server disconnected, stop the subscription
      state.stop = true;
      return false;
    }
  }

  function __generatorSubscription(uri: string, createGen: () => AsyncGenerator<any>): Record<string, never> {
    const state = { stop: false };
    __subscriptions.set(uri, state);
    (async () => {
      try {
        outer: while (!state.stop) {
          for await (const _ of createGen()) {
            if (state.stop) break outer;
            if (!await __notifyUpdated(uri, state)) break outer;
          }
        }
      } catch {
        // Generator error or disconnection
      }
      __subscriptions.delete(uri);
    })();
    return {};
  }

  function __asyncSubscription(uri: string, poll: () => Promise<void>): Record<string, never> {
    const state = { stop: false };
    __subscriptions.set(uri, state);
    (async () => {
      try {
        while (!state.stop) {
          await poll();
          if (!state.stop && !await __notifyUpdated(uri, state)) break;
        }
      } catch {
        // Poll error or disconnection
      }
      __subscriptions.delete(uri);
    })();
    return {};
  }

  server.server.setRequestHandler(SubscribeRequestSchema, async (req): Promise<Record<string, never>> => {
    const uri = req.params.uri;
    if (__subscriptions.has(uri)) return {};
${subscribeMatches}
    return {};
  });

  server.server.setRequestHandler(UnsubscribeRequestSchema, async (req): Promise<Record<string, never>> => {
    const state = __subscriptions.get(req.params.uri);
    if (state) state.stop = true;
    return {};
  });`
    : "";

  return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";${subscriptionImports}${resourceTemplateImport}${uriTemplateImport}${promptTypeImport}${resourceSchemaImport}
${importStatement}
${resourceHelpers}${listHelpers}
export function getServer() {
  const server = new McpServer({
    name: "${serverName}",
    version: "1.0.0",
  }${capabilities});
${toolRegistrations}
${promptRegistrations}
${resourceRegistrations}
${subscriptionHelpersInner}

  return server;
}

// Simple CLI argument parsing
function parseArgs() {
  const args = process.argv.slice(2);
  let port: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(\`${serverName} MCP Server

Usage: ${serverName} [options]

Options:
  --port <port>  Run HTTP server on specified port
  --help, -h     Show this help message

Environment variables:
  MCP_PORT       Run HTTP server on specified port (same as --port)

If no port is specified, runs in stdio mode for use with MCP clients.\`);
      process.exit(0);
    }
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { port: port ?? (process.env.MCP_PORT ? parseInt(process.env.MCP_PORT, 10) : undefined) };
}

// Read request body as JSON
async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// Send JSON-RPC error response
function sendError(res: ServerResponse, code: number, message: string, httpStatus = 400) {
  res.writeHead(httpStatus, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

async function main() {
  const { port } = parseArgs();

  if (port) {
    // HTTP mode with StreamableHTTPServerTransport
    const transports: Record<string, StreamableHTTPServerTransport> = {};

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", \`http://localhost:\${port}\`);

      // Only handle /mcp endpoint
      if (url.pathname !== "/mcp") {
        res.writeHead(404).end("Not Found");
        return;
      }

      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      try {
        if (req.method === "POST") {
          const body = await readBody(req);
          let transport: StreamableHTTPServerTransport;

          if (sessionId && transports[sessionId]) {
            // Reuse existing transport
            transport = transports[sessionId];
          } else if (!sessionId && isInitializeRequest(body)) {
            // New initialization request
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (id) => {
                transports[id] = transport;
              },
            });

            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid && transports[sid]) {
                delete transports[sid];
              }
            };

            // Connect server to transport before handling request
            const server = getServer();
            await server.connect(transport);
          } else {
            sendError(res, -32000, "Bad Request: No valid session ID provided");
            return;
          }

          await transport.handleRequest(req, res, body);
        } else if (req.method === "GET") {
          // SSE stream for existing session
          if (!sessionId || !transports[sessionId]) {
            sendError(res, -32000, "Invalid or missing session ID");
            return;
          }
          await transports[sessionId].handleRequest(req, res);
        } else if (req.method === "DELETE") {
          // Session termination
          if (sessionId && transports[sessionId]) {
            await transports[sessionId].handleRequest(req, res);
          } else {
            res.writeHead(200).end();
          }
        } else {
          res.writeHead(405).end("Method Not Allowed");
        }
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          sendError(res, -32603, "Internal server error", 500);
        }
      }
    });

    httpServer.listen(port, () => {
      console.error(\`${serverName} MCP server running on http://localhost:\${port}/mcp\`);
    });

    // Graceful shutdown
    process.on("SIGINT", async () => {
      console.error("Shutting down...");
      for (const sessionId in transports) {
        await transports[sessionId].close();
      }
      httpServer.close();
      process.exit(0);
    });
  } else {
    // Stdio mode
    const server = getServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch(console.error);
`;
}

export async function generateMcpServer(options: GeneratorOptions): Promise<void> {
  const { entryPath, outputDir, serverName, useStderr } = options;

  // Use stderr when stdout is reserved for stdio transport
  const log = useStderr
    ? (...args: unknown[]) => console.error(...args)
    : (...args: unknown[]) => console.log(...args);
  const warn = (...args: unknown[]) => console.error(...args);

  const name = serverName || basename(entryPath, ".ts");

  const { tools, prompts, resources } = parseTypeScriptFile(entryPath);

  if (tools.length === 0 && prompts.length === 0 && resources.length === 0) {
    throw new Error(
      "No exported functions with JSDoc comments found. " +
        "Make sure your functions are exported and have /** */ doc comments."
    );
  }

  if (tools.length > 0) {
    log(`Found ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`);
  }
  if (prompts.length > 0) {
    log(`Found ${prompts.length} prompt(s): ${prompts.map((p) => p.name).join(", ")}`);
  }
  if (resources.length > 0) {
    log(`Found ${resources.length} resource(s): ${resources.map((r) => r.name).join(", ")}`);
  }

  await mkdir(outputDir, { recursive: true });

  // Step 1: Bundle the user's entry file with all its dependencies
  log("Bundling...");
  const toolsBundlePath = join(outputDir, "tools.mjs");

  // Resolve node_modules from the entry file's directory for user dependencies
  const entryDir = dirname(entryPath);
  const entryNodeModules = join(entryDir, "node_modules");

  await build({
    entryPoints: [entryPath],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: toolsBundlePath,
    nodePaths: [entryNodeModules],
  });

  // Step 1b: Generate type declarations for tools using tsc
  const declTempDir = join(outputDir, ".decl-temp");
  const entryBasename = basename(entryPath, ".ts");
  try {
    execSync(
      `npx tsc "${entryPath}" --declaration --emitDeclarationOnly --outDir "${declTempDir}" --skipLibCheck --moduleResolution node --target esnext`,
      { cwd: entryDir, stdio: "pipe" }
    );
    // Copy the generated .d.ts to tools.d.ts
    await cp(join(declTempDir, `${entryBasename}.d.ts`), join(outputDir, "tools.d.ts"));
  } catch (e: unknown) {
    warn("Warning: Could not generate type declarations for tools");
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string };
    if (err.stdout?.length) {
      warn(err.stdout.toString());
    }
    if (err.stderr?.length) {
      warn(err.stderr.toString());
    }
    if (!err.stdout?.length && !err.stderr?.length && err.message) {
      warn(err.message);
    }
  } finally {
    // Clean up temp directory
    await rm(declTempDir, { recursive: true, force: true });
  }

  // Step 2: Generate and write the server code that imports from the tools bundle
  const serverCode = generateServerCode(tools, prompts, resources, name);
  const serverPath = join(outputDir, "server.ts");
  await writeFile(serverPath, serverCode);

  // Step 3: Bundle the server with the MCP SDK
  log("Bundling server...");

  // Resolve node_modules from mcp-gen installation to find @modelcontextprotocol/sdk
  const mcpGenNodeModules = join(__dirname, "..", "node_modules");

  await build({
    entryPoints: [serverPath],
    bundle: true,
    platform: "node",
    target: "node18",
    format: "esm",
    outfile: join(outputDir, "server.mjs"),
    external: ["./tools.mjs"],
    nodePaths: [mcpGenNodeModules],
    banner: {
      js: "#!/usr/bin/env node",
    },
  });

  // Read source package.json to get user dependencies
  let userDependencies: Record<string, string> = {};
  let userDevDependencies: Record<string, string> = {};
  try {
    const sourcePackageJsonPath = join(entryDir, "package.json");
    const sourcePackageJson = JSON.parse(await readFile(sourcePackageJsonPath, "utf-8"));
    userDependencies = sourcePackageJson.dependencies || {};
    userDevDependencies = sourcePackageJson.devDependencies || {};
  } catch {
    // No package.json or couldn't read it - that's fine
  }

  const packageJson: Record<string, unknown> = {
    name: `${name}-mcp-server`,
    version: "1.0.0",
    type: "module",
    main: "server.mjs",
    bin: {
      [name]: "./server.mjs",
    },
    dependencies: {
      ...userDependencies,
      "@modelcontextprotocol/sdk": "^1.25.2",
      "zod": "^4.3.5",
    },
  };

  if (Object.keys(userDevDependencies).length > 0) {
    packageJson.devDependencies = userDevDependencies;
  }

  await writeFile(
    join(outputDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  log(`Generated files:
  - ${join(outputDir, "tools.mjs")} (bundled tools)
  - ${join(outputDir, "tools.d.ts")} (type declarations)
  - ${join(outputDir, "server.ts")} (server source)
  - ${join(outputDir, "server.mjs")} (bundled server)
  - ${join(outputDir, "package.json")}`);
}
