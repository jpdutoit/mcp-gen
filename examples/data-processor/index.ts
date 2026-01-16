import { validateEmail, validateUrl, validateJson, ValidationResult } from "./src/validators.js";
import { toSnakeCase, toCamelCase, toKebabCase, toPascalCase, csvToJson, jsonToCsv } from "./src/transformers.js";
import { analyzeText, analyzeNumbers, findDuplicates, TextStats, NumberStats } from "./src/analyzers.js";
import { formatNumber, formatBytes, formatDuration, formatDate } from "./src/formatters.js";

/**
 * Validate an email address and return validation result
 * @param email The email address to validate
 */
export function checkEmail(email: string): ValidationResult {
  return validateEmail(email);
}

/**
 * Validate a URL and return validation result
 * @param url The URL to validate
 */
export function checkUrl(url: string): ValidationResult {
  return validateUrl(url);
}

/**
 * Validate a JSON string and return validation result
 * @param json The JSON string to validate
 */
export function checkJson(json: string): ValidationResult {
  return validateJson(json);
}

/**
 * Convert a string to snake_case format
 * @param text The text to convert
 */
export function convertToSnakeCase(text: string): string {
  return toSnakeCase(text);
}

/**
 * Convert a string to camelCase format
 * @param text The text to convert
 */
export function convertToCamelCase(text: string): string {
  return toCamelCase(text);
}

/**
 * Convert a string to kebab-case format
 * @param text The text to convert
 */
export function convertToKebabCase(text: string): string {
  return toKebabCase(text);
}

/**
 * Convert a string to PascalCase format
 * @param text The text to convert
 */
export function convertToPascalCase(text: string): string {
  return toPascalCase(text);
}

/**
 * Convert CSV data to JSON array
 * @param csv The CSV string to convert
 * @param delimiter The delimiter used in CSV (defaults to comma)
 */
export function parseCsv(csv: string, delimiter: string = ","): Record<string, string>[] {
  return csvToJson(csv, delimiter);
}

/**
 * Convert JSON array to CSV string
 * @param json The JSON array as a string
 * @param delimiter The delimiter to use in output CSV (defaults to comma)
 */
export function toCsv(json: string, delimiter: string = ","): string {
  const data = JSON.parse(json) as Record<string, unknown>[];
  return jsonToCsv(data, delimiter);
}

/**
 * Analyze text and return statistics including word count, sentence count, and averages
 * @param text The text to analyze
 */
export function getTextStats(text: string): TextStats {
  return analyzeText(text);
}

/**
 * Analyze an array of numbers and return statistics including mean, median, and standard deviation
 * @param numbers Comma-separated list of numbers
 */
export function getNumberStats(numbers: string): NumberStats {
  const nums = numbers.split(",").map((n) => parseFloat(n.trim())).filter((n) => !isNaN(n));
  return analyzeNumbers(nums);
}

/**
 * Find duplicate values in a comma-separated list
 * @param items Comma-separated list of items
 */
export function getDuplicates(items: string): string[] {
  const itemList = items.split(",").map((i) => i.trim());
  return findDuplicates(itemList);
}

/**
 * Format a number with thousands separators and decimal places
 * @param num The number to format
 * @param decimals Number of decimal places (default 2)
 */
export function formatNum(num: number, decimals: number = 2): string {
  return formatNumber(num, { decimals });
}

/**
 * Format bytes into human readable format (KB, MB, GB, etc.)
 * @param bytes The number of bytes
 */
export function formatFileSize(bytes: number): string {
  return formatBytes(bytes);
}

/**
 * Format milliseconds into human readable duration (e.g., "2d 5h 30m 15s")
 * @param milliseconds The duration in milliseconds
 */
export function formatTime(milliseconds: number): string {
  return formatDuration(milliseconds);
}

/**
 * Format a date string using a format pattern (YYYY-MM-DD HH:mm:ss)
 * @param dateString The date string to format
 * @param format The format pattern (default "YYYY-MM-DD")
 */
export function formatDateString(dateString: string, format: string = "YYYY-MM-DD"): string {
  return formatDate(dateString, format);
}
