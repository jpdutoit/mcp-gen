/**
 * Reverse a string
 * @param text The string to reverse
 */
export function reverse(text: string): string {
  return text.split("").reverse().join("");
}

/**
 * Convert a string to uppercase
 * @param text The string to convert
 */
export function toUpperCase(text: string): string {
  return text.toUpperCase();
}

/**
 * Convert a string to lowercase
 * @param text The string to convert
 */
export function toLowerCase(text: string): string {
  return text.toLowerCase();
}

/**
 * Count the number of words in a string
 * @param text The string to count words in
 */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Check if a string is a palindrome
 * @param text The string to check
 */
export function isPalindrome(text: string): boolean {
  const cleaned = text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned === cleaned.split("").reverse().join("");
}

/**
 * Truncate a string to a specified length with ellipsis
 * @param text The string to truncate
 * @param maxLength The maximum length before truncation
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength - 3) + "...";
}

/**
 * Generate a prompt to summarize the given text
 * @param text The text to summarize
 * @param maxSentences Maximum number of sentences in the summary
 */
export function summarizeTextPrompt(text: string, maxSentences: number = 3) {
  return {
    messages: [
      {
        role: "user" ,
        content: {
          type: "text",
          text: `Please summarize the following text in ${maxSentences} sentences or less:\n\n${text}\n\nProvide a concise summary that captures the main points.`,
        },
      },
    ],
  };
}

/**
 * Generate a prompt to rewrite text in a different tone
 * @param text The text to rewrite
 * @param tone The desired tone (e.g., "formal", "casual", "professional", "friendly")
 */
export function rewriteTonePrompt(text: string, tone: string): string {
  return `Please rewrite the following text in a ${tone} tone:\n\n${text}\n\nKeep the meaning the same but adjust the style and word choice to match the ${tone} tone.`;
}

/**
 * Generate a prompt to translate text
 * @param text The text to translate
 * @param targetLanguage The language to translate to
 */
export function translateTextPrompt(text: string, targetLanguage: string): string {
  return `Please translate the text to "${targetLanguage}". Provide only the translation without any additional explanation:
${text}
  `;
}
