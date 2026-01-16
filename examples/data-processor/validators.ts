import { validateEmail, validateUrl, validateJson, ValidationResult } from "./src/validators.js";
import { analyzeText, TextStats } from "./src/analyzers.js";

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
 * Validate multiple items at once and return a summary
 * @param email Email to validate
 * @param url URL to validate
 * @param json JSON string to validate
 */
export function validateAll(email: string, url: string, json: string): {
  email: ValidationResult;
  url: ValidationResult;
  json: ValidationResult;
  allValid: boolean;
} {
  const emailResult = validateEmail(email);
  const urlResult = validateUrl(url);
  const jsonResult = validateJson(json);

  return {
    email: emailResult,
    url: urlResult,
    json: jsonResult,
    allValid: emailResult.valid && urlResult.valid && jsonResult.valid,
  };
}

/**
 * Analyze text and check if it meets minimum requirements
 * @param text The text to analyze
 * @param minWords Minimum word count required
 * @param minSentences Minimum sentence count required
 */
export function validateText(text: string, minWords: number, minSentences: number): {
  stats: TextStats;
  meetsRequirements: boolean;
  errors: string[];
} {
  const stats = analyzeText(text);
  const errors: string[] = [];

  if (stats.wordCount < minWords) {
    errors.push(`Text has ${stats.wordCount} words, minimum is ${minWords}`);
  }
  if (stats.sentenceCount < minSentences) {
    errors.push(`Text has ${stats.sentenceCount} sentences, minimum is ${minSentences}`);
  }

  return {
    stats,
    meetsRequirements: errors.length === 0,
    errors,
  };
}
