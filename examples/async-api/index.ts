/**
 * Fetch a random joke from an API
 */
export async function getRandomJoke(): Promise<string> {
  const response = await fetch("https://official-joke-api.appspot.com/random_joke");
  const data = await response.json() as { setup: string; punchline: string };
  return `${data.setup}\n\n${data.punchline}`;
}

/**
 * Get the current time in a specified timezone
 * @param timezone The timezone to get time for (e.g., "America/New_York")
 */
export async function getCurrentTime(timezone: string): Promise<string> {
  const now = new Date();
  return now.toLocaleString("en-US", { timeZone: timezone });
}

/**
 * Delay execution for a specified number of milliseconds
 * @param ms The number of milliseconds to delay
 */
export async function delay(ms: number): Promise<string> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  return `Delayed for ${ms}ms`;
}

/**
 * Generate a random UUID
 */
export async function generateUUID(): Promise<string> {
  return crypto.randomUUID();
}
