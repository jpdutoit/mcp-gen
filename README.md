# mcp-gen

Generate MCP (Model Context Protocol) servers from TypeScript functions using JSDoc comments.

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Defining Tools](#defining-tools)
  - [Structured Output](#structured-output)
- [Defining Prompts](#defining-prompts)
  - [String Return](#string-return)
  - [GetPromptResult Return](#getpromptresult-return)
- [Defining Resources](#defining-resources)
  - [Resource Return Types](#resource-return-types)
  - [Templated Resources](#templated-resources)
  - [Listing Templated Resources](#listing-templated-resources)
  - [Subscribable Resources](#subscribable-resources)
- [Scripts](#scripts)
- [Examples](#examples)
- [License](#license)

## Installation

```bash
pnpm install
pnpm run build
```

## Usage

```bash
mcp-gen <entry-file> -o <output-dir> [-n <server-name>]
mcp-gen <entry-file> --run  # Compile and run immediately
```

**Examples:**
```bash
# Generate to output folder
mcp-gen src/tools.ts -o output -n my-server

# Compile to temp folder and run immediately
mcp-gen src/tools.ts --run
```

This will generate a complete MCP server package in the output directory with:
- `tools.mjs` - Bundled tool implementations
- `server.ts` - Generated server source
- `server.mjs` - Bundled server (executable)
- `package.json` - Server dependencies

## Defining Tools

Export functions with JSDoc comments. By default, exported functions become tools. Use the optional `@tool` tag to specify a custom name:

```typescript
@tool              // Uses function name as tool name (optional, this is the default)
@tool customName   // Uses "customName" as tool name
```

```typescript
/**
 * Add two numbers together
 * @param a First number
 * @param b Second number
 */
export function add(a: number, b: number) {
  return a + b;
}
```

### Structured Output

Return types are handled as follows:

- **Objects** - Returned as `structuredContent` with an auto-generated `outputSchema`, plus a JSON text fallback in `content`
- **Arrays** - Wrapped in `{ results: T[] }` since MCP requires object types for `structuredContent`
- **Primitives** (`string`, `number`, `boolean`) - Returned as text content only

## Defining Prompts

Use the `@prompt` JSDoc tag to define prompts. Optionally specify a custom name after the tag (defaults to the function name):

```typescript
@prompt              // Uses function name as prompt name
@prompt customName   // Uses "customName" as prompt name
```

### String Return

Return a string for a user message:

```typescript
/**
 * Generate a code review prompt
 * @prompt
 * @param code The code to review
 * @param language Programming language
 */
export function codeReview(code: string, language: string) {
  return `Please review this ${language} code:\n\n${code}`;
}
```

### GetPromptResult Return

Return a [`GetPromptResult`](https://github.com/modelcontextprotocol/typescript-sdk/blob/71ae3ac/packages/core/src/types/spec.types.ts#L974)-style object for more control:

```typescript
/**
 * Generate a prompt to summarize text
 * @prompt
 * @param text The text to summarize
 */
export function summarizeText(text: string) {
  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Please summarize:\n\n${text}`,
        },
      },
    ],
  };
}
```

## Defining Resources

Use the `@resource` JSDoc tag to define resources:

```typescript
/**
 * Get the current working directory
 * @resource sys://cwd
 * @mimeType text/plain
 */
export async function cwd() {
  return process.cwd();
}
```

### Resource Return Types

Resources can return:
- A plain string
- A [`TextResourceContents`](https://github.com/modelcontextprotocol/typescript-sdk/blob/71ae3ac/packages/core/src/types/spec.types.ts#L905) object: `{ text, mimeType? }`
- A [`BlobResourceContents`](https://github.com/modelcontextprotocol/typescript-sdk/blob/71ae3ac/packages/core/src/types/spec.types.ts#L915) object: `{ blob, mimeType? }`
- A full [`ReadResourceResult`](https://github.com/modelcontextprotocol/typescript-sdk/blob/71ae3ac/packages/core/src/types/spec.types.ts#L726) with `contents` array

```typescript
/**
 * Current system time
 * @resource sys://time
 */
export function systemTime() {
  return {
    mimeType: "text/plain",
    text: new Date().toISOString()
  };
}
```

### Templated Resources

Use `{param}` syntax in the URI for templated resources:

```typescript
/**
 * Get a specific number
 * @param number The number to return
 * @resource sys://numbers/{number}
 * @mimeType text/plain
 */
export function numbers(number: number) {
  return `Your number is ${number}`;
}
```

### Listing Templated Resources

Add a `.list` function to enumerate available resources. Return an array of URI strings or [`Resource`](https://github.com/modelcontextprotocol/typescript-sdk/blob/71ae3ac/packages/core/src/types/spec.types.ts#L805) objects:

```typescript
numbers.list = function() {
  // Return array of URIs (strings)
  return Array.from({ length: 10 }, (_, i) => `sys://numbers/${i + 1}`);

  // Or return array of Resource objects with uri, name, mimeType, description
  // return [{ uri: "sys://numbers/1", name: "One" }, ...]
};
```

### Subscribable Resources

Add a `.subscribe` function to make resources subscribable. The server will notify clients when the resource updates.

**Generator-based** (stays alive while subscribed):
```typescript
/**
 * Current working directory
 * @resource sys://cwd
 */
export async function cwd() {
  return process.cwd();
}

cwd.subscribe = async function*() {
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    yield; // Signals an update
  }
};
```

**Async-based** (called repeatedly):
```typescript
/**
 * System time
 * @resource sys://time
 */
export function systemTime() {
  return { text: new Date().toISOString() };
}

systemTime.subscribe = async function() {
  // Wait for next update
  await new Promise(resolve => setTimeout(resolve, 1000));
};
```

**Templated resources** receive the matched URI variables:
```typescript
/**
 * Get a specific number
 * @resource sys://numbers/{number}
 */
export function numbers(number: number) {
  return `Your number is ${number}`;
}

numbers.subscribe = async function*(vars: { number: string }) {
  // vars.number contains the matched URI parameter
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    yield;
  }
};
```

## Scripts

```bash
# Build the generator
pnpm run build

# Build all examples
pnpm run build:examples

# Run MCP inspector on an output
pnpm run inspect <path-to-output>

# Clean all example outputs
pnpm run clean
```

## Examples

See the `examples/` directory for complete examples:

- `file-ops/` - File system tools and resources
- `string-utils/` - String manipulation tools and prompts
- `async-api/` - Async API examples
- `data-processor/` - Multi-module project example

## License

MIT
