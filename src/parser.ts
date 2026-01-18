import { Project, SourceFile, FunctionDeclaration, SyntaxKind, Type } from "ts-morph";

export interface ToolParameter {
  name: string;
  type: string;
  description?: string;
  required: boolean;
}

export interface OutputSchemaProperty {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  optional?: boolean;
  items?: OutputSchema; // For arrays
  properties?: OutputSchemaProperty[]; // For nested objects
}

export interface OutputSchema {
  type: "string" | "number" | "boolean" | "array" | "object" | "void" | "record";
  properties?: OutputSchemaProperty[]; // For objects
  items?: OutputSchema; // For arrays
  valueType?: OutputSchema; // For record types (Record<string, T>)
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  returnType: string;
  outputSchema?: OutputSchema;
}

export interface PromptDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
}

export interface ResourceDefinition {
  name: string;
  description: string;
  uri: string;
  mimeType?: string;
  parameters: ToolParameter[];
  subscribeType?: "generator" | "async";
  hasList?: boolean;
}

export interface ParseResult {
  tools: ToolDefinition[];
  prompts: PromptDefinition[];
  resources: ResourceDefinition[];
  sourceFile: SourceFile;
}

interface JsDocBase {
  description: string;
  params: Map<string, string>;
}

interface JsDocTool extends JsDocBase {
  kind: "tool";
  toolName?: string; // undefined = use function name, non-empty = custom name
}

interface JsDocPrompt extends JsDocBase {
  kind: "prompt";
  promptName?: string; // undefined = use function name, non-empty = custom name
}

interface JsDocResource extends JsDocBase {
  kind: "resource";
  uri: string;
  mimeType?: string;
}

type JsDocParseResult = JsDocTool | JsDocPrompt | JsDocResource;

function parseJsDocDescription(jsDoc: string): JsDocParseResult {
  const lines = jsDoc.split("\n");
  const descriptionLines: string[] = [];
  const params = new Map<string, string>();
  let uri: string | undefined;
  let mimeType: string | undefined;
  let toolName: string | undefined;
  let promptName: string | undefined;
  let isPrompt = false;

  for (const line of lines) {
    const trimmed = line.replace(/^\s*\*\s?/, "").trim();

    if (trimmed.startsWith("@param")) {
      const match = trimmed.match(/@param\s+(?:\{[^}]+\}\s+)?(\w+)\s*(.*)/);
      if (match) {
        params.set(match[1], match[2].trim());
      }
    } else if (trimmed.startsWith("@resource")) {
      const match = trimmed.match(/@resource\s+(.+)/);
      if (match) {
        uri = match[1].trim();
      }
    } else if (trimmed.startsWith("@mimeType")) {
      const match = trimmed.match(/@mimeType\s+(.+)/);
      if (match) {
        // Remove quotes if present
        mimeType = match[1].trim().replace(/^["']|["']$/g, "");
      }
    } else if (trimmed.startsWith("@tool")) {
      const match = trimmed.match(/@tool\s+(\S+)/);
      toolName = match ? match[1].trim() : undefined;
    } else if (trimmed.startsWith("@prompt")) {
      isPrompt = true;
      const match = trimmed.match(/@prompt\s+(\S+)/);
      promptName = match ? match[1].trim() : undefined;
    } else if (trimmed.startsWith("@")) {
      continue;
    } else if (trimmed && !trimmed.startsWith("/")) {
      descriptionLines.push(trimmed);
    }
  }

  const description = descriptionLines.join(" ").trim();

  if (uri) {
    return { kind: "resource", description, params, uri, mimeType };
  }
  if (isPrompt) {
    return { kind: "prompt", description, params, promptName };
  }
  // Default to tool (with or without explicit @tool tag)
  return { kind: "tool", description, params, toolName };
}

function typeToJsonSchemaType(type: Type): string {
  const typeText = type.getText();

  if (type.isString() || typeText === "string") return "string";
  if (type.isNumber() || typeText === "number") return "number";
  if (type.isBoolean() || typeText === "boolean") return "boolean";
  if (type.isArray()) return "array";
  if (type.isObject()) return "object";

  return "string";
}

function typeToOutputSchemaType(type: Type): OutputSchema["type"] {
  if (type.isString()) return "string";
  if (type.isNumber()) return "number";
  if (type.isBoolean()) return "boolean";
  if (type.isArray()) return "array";

  // Check for void/undefined
  const typeText = type.getText();
  if (typeText === "void" || typeText === "undefined" || type.isUndefined()) {
    return "void";
  }

  if (type.isObject()) return "object";

  return "string";
}

function parseTypeToOutputSchema(type: Type): OutputSchema | undefined {
  // Unwrap Promise<T> to get T
  const typeText = type.getText();
  if (typeText.startsWith("Promise<")) {
    const typeArgs = type.getTypeArguments();
    if (typeArgs.length > 0) {
      return parseTypeToOutputSchema(typeArgs[0]);
    }
  }

  const schemaType = typeToOutputSchemaType(type);

  // Skip void returns
  if (schemaType === "void") {
    return undefined;
  }

  // Handle primitives
  if (schemaType === "string" || schemaType === "number" || schemaType === "boolean") {
    return { type: schemaType };
  }

  // Handle arrays
  if (schemaType === "array" || type.isArray()) {
    const arrayType = type.getArrayElementType();
    if (arrayType) {
      const items = parseTypeToOutputSchema(arrayType);
      return { type: "array", items: items ?? { type: "string" } };
    }
    return { type: "array", items: { type: "string" } };
  }

  // Handle objects with properties
  if (schemaType === "object") {
    const properties = type.getProperties();

    // Check for index signature types (like Record<string, T>)
    const stringIndexType = type.getStringIndexType();
    if (stringIndexType) {
      const valueSchema = parseTypeToOutputSchema(stringIndexType);
      return { type: "record", valueType: valueSchema ?? { type: "string" } };
    }

    // Skip if no properties (e.g., generic object, or built-in types)
    if (properties.length === 0) {
      return undefined;
    }

    // Skip certain built-in types
    const symbol = type.getSymbol();
    const typeName = symbol?.getName();
    if (typeName === "Date" || typeName === "RegExp" || typeName === "Error") {
      return undefined;
    }

    const schemaProperties: OutputSchemaProperty[] = [];

    for (const prop of properties) {
      const propName = prop.getName();
      const propDeclarations = prop.getDeclarations();

      // Skip internal/private properties
      if (propName.startsWith("_")) continue;

      let propType: Type | undefined;
      let isOptional = false;

      if (propDeclarations.length > 0) {
        const decl = propDeclarations[0];
        propType = decl.getType();

        // Check if property is optional
        if (decl.getKind() === SyntaxKind.PropertySignature) {
          const propSig = decl as import("ts-morph").PropertySignature;
          isOptional = propSig.hasQuestionToken();
        }
      } else {
        propType = prop.getTypeAtLocation(prop.getValueDeclaration()!);
      }

      if (!propType) continue;

      const propSchema = parseTypeToOutputSchema(propType);
      if (!propSchema) continue;

      const schemaProp: OutputSchemaProperty = {
        name: propName,
        type: propSchema.type as OutputSchemaProperty["type"],
        optional: isOptional || undefined,
      };

      if (propSchema.items) {
        schemaProp.items = propSchema.items;
      }
      if (propSchema.properties) {
        schemaProp.properties = propSchema.properties;
      }

      schemaProperties.push(schemaProp);
    }

    if (schemaProperties.length === 0) {
      return undefined;
    }

    return { type: "object", properties: schemaProperties };
  }

  return undefined;
}

function isGeneratorType(type: Type): boolean {
  const typeText = type.getText();
  return (
    typeText.includes("Generator<") ||
    typeText.includes("AsyncGenerator<") ||
    typeText.includes("IterableIterator<") ||
    typeText.includes("AsyncIterableIterator<")
  );
}

function detectSubscribeType(sourceFile: SourceFile, fnName: string): "generator" | "async" | undefined {
  // Look for fnName.subscribe = ... in the source file
  const text = sourceFile.getFullText();

  // Match patterns like: fnName.subscribe = async function*() or fnName.subscribe = async function()
  const subscribePattern = new RegExp(`${fnName}\\.subscribe\\s*=\\s*(async\\s+)?function\\s*(\\*)?`, "m");
  const match = text.match(subscribePattern);

  if (!match) return undefined;

  // Check if it's a generator (has *)
  if (match[2] === "*") {
    return "generator";
  }

  return "async";
}

function detectHasList(sourceFile: SourceFile, fnName: string): boolean {
  const text = sourceFile.getFullText();
  // Match patterns like: fnName.list = function() or fnName.list = async function() or fnName.list = () =>
  const listPattern = new RegExp(`${fnName}\\.list\\s*=`, "m");
  return listPattern.test(text);
}

export function parseTypeScriptFile(filePath: string): ParseResult {
  const project = new Project({
    tsConfigFilePath: undefined,
    compilerOptions: {
      allowJs: true,
      declaration: false,
    },
  });

  const sourceFile = project.addSourceFileAtPath(filePath);
  const tools: ToolDefinition[] = [];
  const prompts: PromptDefinition[] = [];
  const resources: ResourceDefinition[] = [];

  const exportedFunctions = sourceFile.getFunctions().filter((fn) => fn.isExported());

  for (const fn of exportedFunctions) {
    const name = fn.getName();
    if (!name) continue;

    const jsDocNodes = fn.getJsDocs();
    if (jsDocNodes.length === 0) continue;

    const jsDocText = jsDocNodes[0].getText();
    const jsDoc = parseJsDocDescription(jsDocText);

    if (!jsDoc.description) continue;

    const parameters: ToolParameter[] = [];

    for (const param of fn.getParameters()) {
      const paramName = param.getName();
      const paramType = param.getType();
      const isOptional = param.isOptional() || param.hasInitializer();

      parameters.push({
        name: paramName,
        type: typeToJsonSchemaType(paramType),
        description: jsDoc.params.get(paramName),
        required: !isOptional,
      });
    }

    const returnType = fn.getReturnType();

    switch (jsDoc.kind) {
      case "resource": {
        const subscribeType = detectSubscribeType(sourceFile, name);
        const hasList = detectHasList(sourceFile, name);
        resources.push({
          name,
          description: jsDoc.description,
          uri: jsDoc.uri,
          mimeType: jsDoc.mimeType,
          parameters,
          subscribeType,
          hasList,
        });
        break;
      }
      case "prompt":
        prompts.push({
          name: jsDoc.promptName || name,
          description: jsDoc.description,
          parameters,
        });
        break;
      case "tool": {
        const outputSchema = parseTypeToOutputSchema(returnType);
        tools.push({
          name: jsDoc.toolName || name,
          description: jsDoc.description,
          parameters,
          returnType: returnType.getText(),
          outputSchema,
        });
        break;
      }
    }
  }

  return { tools, prompts, resources, sourceFile };
}
