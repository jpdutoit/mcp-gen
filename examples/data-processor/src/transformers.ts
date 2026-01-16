import Papa from "papaparse";

export interface TransformOptions {
  preserveCase?: boolean;
  trimWhitespace?: boolean;
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

export function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (c) => c.toLowerCase());
}

export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

export function toPascalCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (c) => c.toUpperCase());
}

export function csvToJson(csv: string, delimiter: string = ","): Record<string, string>[] {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    delimiter,
    skipEmptyLines: true,
  });
  return result.data;
}

export function jsonToCsv(data: Record<string, unknown>[], delimiter: string = ","): string {
  return Papa.unparse(data, { delimiter });
}
