// examples/data-processor/src/validators.ts
function validateEmail(email) {
  const errors = [];
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email) {
    errors.push("Email is required");
  } else if (!emailRegex.test(email)) {
    errors.push("Invalid email format");
  }
  return { valid: errors.length === 0, errors };
}
function validateUrl(url) {
  const errors = [];
  try {
    new URL(url);
  } catch {
    errors.push("Invalid URL format");
  }
  return { valid: errors.length === 0, errors };
}
function validateJson(jsonString) {
  const errors = [];
  try {
    JSON.parse(jsonString);
  } catch (e) {
    errors.push(`Invalid JSON: ${e.message}`);
  }
  return { valid: errors.length === 0, errors };
}

// examples/data-processor/src/analyzers.ts
function analyzeText(text) {
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
    avgSentenceLength: sentences.length > 0 ? words.length / sentences.length : 0
  };
}

// examples/data-processor/validators.ts
function checkEmail(email) {
  return validateEmail(email);
}
function checkUrl(url) {
  return validateUrl(url);
}
function checkJson(json) {
  return validateJson(json);
}
function validateAll(email, url, json) {
  const emailResult = validateEmail(email);
  const urlResult = validateUrl(url);
  const jsonResult = validateJson(json);
  return {
    email: emailResult,
    url: urlResult,
    json: jsonResult,
    allValid: emailResult.valid && urlResult.valid && jsonResult.valid
  };
}
function validateText(text, minWords, minSentences) {
  const stats = analyzeText(text);
  const errors = [];
  if (stats.wordCount < minWords) {
    errors.push(`Text has ${stats.wordCount} words, minimum is ${minWords}`);
  }
  if (stats.sentenceCount < minSentences) {
    errors.push(`Text has ${stats.sentenceCount} sentences, minimum is ${minSentences}`);
  }
  return {
    stats,
    meetsRequirements: errors.length === 0,
    errors
  };
}
export {
  checkEmail,
  checkJson,
  checkUrl,
  validateAll,
  validateText
};
