import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkEmail, checkUrl, checkJson, validateAll, validateText } from "./tools.mjs";

const server = new McpServer({
  name: "validators",
  version: "1.0.0",
});


  server.registerTool(
    "checkEmail",
    {
      description: "Validate an email address and return validation result",
      inputSchema: {
    email: z.string().describe("The email address to validate")
  },
      outputSchema: z.object({
          valid: z.boolean(),
          errors: z.array(z.string())
        }),
    },
    async (args) => {
      const { email } = args;
      const result = await checkEmail(email);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "checkUrl",
    {
      description: "Validate a URL and return validation result",
      inputSchema: {
    url: z.string().describe("The URL to validate")
  },
      outputSchema: z.object({
          valid: z.boolean(),
          errors: z.array(z.string())
        }),
    },
    async (args) => {
      const { url } = args;
      const result = await checkUrl(url);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "checkJson",
    {
      description: "Validate a JSON string and return validation result",
      inputSchema: {
    json: z.string().describe("The JSON string to validate")
  },
      outputSchema: z.object({
          valid: z.boolean(),
          errors: z.array(z.string())
        }),
    },
    async (args) => {
      const { json } = args;
      const result = await checkJson(json);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "validateAll",
    {
      description: "Validate multiple items at once and return a summary",
      inputSchema: {
    email: z.string().describe("Email to validate"),
    url: z.string().describe("URL to validate"),
    json: z.string().describe("JSON string to validate")
  },
      outputSchema: z.object({
          email: z.object({
            valid: z.boolean(),
            errors: z.array(z.string())
          }),
          url: z.object({
            valid: z.boolean(),
            errors: z.array(z.string())
          }),
          json: z.object({
            valid: z.boolean(),
            errors: z.array(z.string())
          }),
          allValid: z.boolean()
        }),
    },
    async (args) => {
      const { email, url, json } = args;
      const result = await validateAll(email, url, json);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );

  server.registerTool(
    "validateText",
    {
      description: "Analyze text and check if it meets minimum requirements",
      inputSchema: {
    text: z.string().describe("The text to analyze"),
    minWords: z.number().describe("Minimum word count required"),
    minSentences: z.number().describe("Minimum sentence count required")
  },
      outputSchema: z.object({
          stats: z.object({
            characterCount: z.number(),
            wordCount: z.number(),
            lineCount: z.number(),
            sentenceCount: z.number(),
            avgWordLength: z.number(),
            avgSentenceLength: z.number()
          }),
          meetsRequirements: z.boolean(),
          errors: z.array(z.string())
        }),
    },
    async (args) => {
      const { text, minWords, minSentences } = args;
      const result = await validateText(text, minWords, minSentences);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
        structuredContent: result,
      };
    }
  );





async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
