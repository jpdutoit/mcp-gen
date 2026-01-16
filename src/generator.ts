import { mkdir, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";
import { build } from "esbuild";
import { parseTypeScriptFile, ToolDefinition, PromptDefinition, ResourceDefinition, ToolParameter, OutputSchema, OutputSchemaProperty } from "./parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface GeneratorOptions {
  entryPath: string;
  outputDir: string;
  serverName?: string;
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

      let outputSchemaStr: string;
      if (hasOutputSchema) {
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
      if (hasOutputSchema) {
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
      // Remove "Prompt" suffix from the registered name
      const promptId = prompt.name.replace(/Prompt$/, "");

      return `
  server.registerPrompt(
    "${promptId}",
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

      // Build the read callback using MCP SDK schemas for validation
      // Type assertion needed because TS narrows to 'never' after string check for functions returning string
      const resultType = `string | { text: string; mimeType?: string } | { blob: string; mimeType?: string }`;
      let readCallback: string;
      if (hasParams) {
        // Resource with URI template parameters - callback receives (uri, variables, extra)
        const argsExtract = paramNames.map((p) => `const ${p} = variables.${p} as string;`).join("\n      ");
        readCallback = `async (uri, variables) => {
      ${argsExtract}
      const result = await ${resource.name}(${paramNames.join(", ")}) as ${resultType};
      if (typeof result === "string") {
        return {
          contents: [TextResourceContentsSchema.parse({ uri: uri.href, mimeType: ${defaultMimeType}, text: result })],
        };
      }
      if ("blob" in result) {
        return {
          contents: [BlobResourceContentsSchema.parse({ uri: uri.href, mimeType: result.mimeType ?? ${defaultMimeType}, blob: result.blob })],
        };
      }
      return {
        contents: [TextResourceContentsSchema.parse({ uri: uri.href, mimeType: result.mimeType ?? ${defaultMimeType}, text: result.text })],
      };
    }`;
      } else {
        // Resource without parameters
        readCallback = `async (uri) => {
      const result = await ${resource.name}() as ${resultType};
      if (typeof result === "string") {
        return {
          contents: [TextResourceContentsSchema.parse({ uri: uri.href, mimeType: ${defaultMimeType}, text: result })],
        };
      }
      if ("blob" in result) {
        return {
          contents: [BlobResourceContentsSchema.parse({ uri: uri.href, mimeType: result.mimeType ?? ${defaultMimeType}, blob: result.blob })],
        };
      }
      return {
        contents: [TextResourceContentsSchema.parse({ uri: uri.href, mimeType: result.mimeType ?? ${defaultMimeType}, text: result.text })],
      };
    }`;
      }

      // URI is already in {param} format for MCP
      const mcpUri = resource.uri;

      // Use ResourceTemplate for templated URIs
      let uriArg: string;
      if (hasParams) {
        if (resource.hasList) {
          // Generate list callback that handles both string[] and object[] returns
          const listCallback = `async () => {
        const items = await ${resource.name}.list();
        const getName = (uri: string) => uri.split("/").pop() || uri;
        return {
          resources: items.map((item: string | { uri: string; name?: string; mimeType?: string }) => {
            if (typeof item === "string") {
              return { uri: item, name: getName(item), mimeType: ${defaultMimeType} };
            }
            const data = ResourceSchema.parse(item);
            return { ...data, name: data.name ?? getName(data.uri), mimeType: data.mimeType ?? ${defaultMimeType} };
          }),
        };
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

  // Generate subscription setup code for each subscribable resource
  const subscriptionSetup = resources
    .filter((r) => r.subscribeType)
    .map((resource) => {
      const uri = resource.uri;

      if (resource.subscribeType === "generator") {
        // Generator-based subscription - keep generator alive while subscribed
        return `
// Subscription for ${resource.name}
const ${resource.name}Generators = new Map<string, { gen: AsyncGenerator<any>; stop: boolean }>();

async function start${resource.name}Subscription(uri: string) {
  if (${resource.name}Generators.has(uri)) return;

  const gen = ${resource.name}.subscribe();
  const state = { gen, stop: false };
  ${resource.name}Generators.set(uri, state);

  (async () => {
    for await (const _ of gen) {
      if (state.stop || !subscriptions.has(uri)) {
        break;
      }
      await server.server.notification({
        method: "notifications/resources/updated",
        params: { uri }
      });
    }
    ${resource.name}Generators.delete(uri);
  })();
}

function stop${resource.name}Subscription(uri: string) {
  const state = ${resource.name}Generators.get(uri);
  if (state) {
    state.stop = true;
    ${resource.name}Generators.delete(uri);
  }
}`;
      } else {
        // Async-based subscription - call repeatedly while subscribed
        return `
// Subscription for ${resource.name}
const ${resource.name}Intervals = new Map<string, boolean>();

async function start${resource.name}Subscription(uri: string) {
  if (${resource.name}Intervals.has(uri)) return;

  ${resource.name}Intervals.set(uri, true);

  (async () => {
    while (${resource.name}Intervals.get(uri) && subscriptions.has(uri)) {
      await ${resource.name}.subscribe();
      if (!${resource.name}Intervals.get(uri) || !subscriptions.has(uri)) break;
      await server.server.notification({
        method: "notifications/resources/updated",
        params: { uri }
      });
    }
    ${resource.name}Intervals.delete(uri);
  })();
}

function stop${resource.name}Subscription(uri: string) {
  ${resource.name}Intervals.delete(uri);
}`;
      }
    })
    .join("\n");

  // Generate subscribe/unsubscribe handlers
  const subscriptionHandlers = hasSubscriptions
    ? `
const subscriptions = new Set<string>();

server.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
  const uri = req.params.uri;
  subscriptions.add(uri);

  // Start the appropriate subscription
${resources
  .filter((r) => r.subscribeType)
  .map((r) => {
    const uri = r.uri;
    return `  if (uri.startsWith("${uri.split("{")[0]}")) {
    await start${r.name}Subscription(uri);
  }`;
  })
  .join("\n")}

  return {};
});

server.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
  const uri = req.params.uri;
  subscriptions.delete(uri);

  // Stop the appropriate subscription
${resources
  .filter((r) => r.subscribeType)
  .map((r) => {
    const uri = r.uri;
    return `  if (uri.startsWith("${uri.split("{")[0]}")) {
    stop${r.name}Subscription(uri);
  }`;
  })
  .join("\n")}

  return {};
});`
    : "";

  const hasTemplatedResources = resources.some((r) => r.parameters.length > 0);
  const resourceTemplateImport = hasTemplatedResources
    ? `\nimport { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";`
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
    typesImports.push("TextResourceContentsSchema", "BlobResourceContentsSchema");
  }
  if (hasListResources) {
    typesImports.push("ResourceSchema");
  }
  const resourceSchemaImport = typesImports.length > 0
    ? `\nimport { ${typesImports.join(", ")} } from "@modelcontextprotocol/sdk/types.js";`
    : "";

  return `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";${subscriptionImports}${resourceTemplateImport}${promptTypeImport}${resourceSchemaImport}
${importStatement}

const server = new McpServer({
  name: "${serverName}",
  version: "1.0.0",
}${capabilities});

${toolRegistrations}
${promptRegistrations}
${resourceRegistrations}
${subscriptionSetup}
${subscriptionHandlers}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
`;
}

export async function generateMcpServer(options: GeneratorOptions): Promise<void> {
  const { entryPath, outputDir, serverName } = options;

  const name = serverName || basename(entryPath, ".ts");

  const { tools, prompts, resources } = parseTypeScriptFile(entryPath);

  if (tools.length === 0 && prompts.length === 0 && resources.length === 0) {
    throw new Error(
      "No exported functions with JSDoc comments found. " +
        "Make sure your functions are exported and have /** */ doc comments."
    );
  }

  if (tools.length > 0) {
    console.log(`Found ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`);
  }
  if (prompts.length > 0) {
    console.log(`Found ${prompts.length} prompt(s): ${prompts.map((p) => p.name).join(", ")}`);
  }
  if (resources.length > 0) {
    console.log(`Found ${resources.length} resource(s): ${resources.map((r) => r.name).join(", ")}`);
  }

  await mkdir(outputDir, { recursive: true });

  // Step 1: Bundle the user's entry file with all its dependencies
  console.log("Bundling...");
  const toolsBundlePath = join(outputDir, "tools.mjs");

  await build({
    entryPoints: [entryPath],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: toolsBundlePath,
  });

  // Step 2: Generate and write the server code that imports from the tools bundle
  const serverCode = generateServerCode(tools, prompts, resources, name);
  const serverPath = join(outputDir, "server.ts");
  await writeFile(serverPath, serverCode);

  // Step 3: Bundle the server with the MCP SDK
  console.log("Bundling server...");

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

  const packageJson = {
    name: `${name}-mcp-server`,
    version: "1.0.0",
    type: "module",
    main: "server.mjs",
    bin: {
      [name]: "./server.mjs",
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.25.2",
      "zod": "^4.3.5",
    },
  };

  await writeFile(
    join(outputDir, "package.json"),
    JSON.stringify(packageJson, null, 2)
  );

  console.log(`Generated files:
  - ${join(outputDir, "tools.mjs")} (bundled tools)
  - ${join(outputDir, "server.ts")} (server source)
  - ${join(outputDir, "server.mjs")} (bundled server)
  - ${join(outputDir, "package.json")}`);
}
