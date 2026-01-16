export interface TextStats {
  characterCount: number;
  wordCount: number;
  lineCount: number;
  sentenceCount: number;
  avgWordLength: number;
  avgSentenceLength: number;
}

export function analyzeText(text: string): TextStats {
  const chars = text.length;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = text.split("\n").length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  const totalWordLength = words.reduce((sum, word) => sum + word.length, 0);

  return {
    characterCount: chars,
    wordCount: words.length,
    lineCount: lines,
    sentenceCount: sentences.length,
    avgWordLength: words.length > 0 ? totalWordLength / words.length : 0,
    avgSentenceLength: sentences.length > 0 ? words.length / sentences.length : 0,
  };
}

export interface NumberStats {
  count: number;
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
}

export function analyzeNumbers(numbers: number[]): NumberStats {
  if (numbers.length === 0) {
    return { count: 0, sum: 0, mean: 0, median: 0, min: 0, max: 0, stdDev: 0 };
  }

  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((a, b) => a + b, 0);
  const mean = sum / numbers.length;

  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  const variance =
    numbers.reduce((acc, n) => acc + Math.pow(n - mean, 2), 0) / numbers.length;
  const stdDev = Math.sqrt(variance);

  return {
    count: numbers.length,
    sum,
    mean,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    stdDev,
  };
}

export function findDuplicates<T>(items: T[]): T[] {
  const seen = new Set<T>();
  const duplicates = new Set<T>();

  for (const item of items) {
    if (seen.has(item)) {
      duplicates.add(item);
    }
    seen.add(item);
  }

  return Array.from(duplicates);
}
