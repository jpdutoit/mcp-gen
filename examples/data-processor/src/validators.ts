export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateEmail(email: string): ValidationResult {
  const errors: string[] = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!email) {
    errors.push("Email is required");
  } else if (!emailRegex.test(email)) {
    errors.push("Invalid email format");
  }

  return { valid: errors.length === 0, errors };
}

export function validateUrl(url: string): ValidationResult {
  const errors: string[] = [];

  try {
    new URL(url);
  } catch {
    errors.push("Invalid URL format");
  }

  return { valid: errors.length === 0, errors };
}

export function validateJson(jsonString: string): ValidationResult {
  const errors: string[] = [];

  try {
    JSON.parse(jsonString);
  } catch (e) {
    errors.push(`Invalid JSON: ${(e as Error).message}`);
  }

  return { valid: errors.length === 0, errors };
}
