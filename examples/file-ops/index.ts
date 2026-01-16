import { readFile, writeFile, readdir, stat } from "fs/promises";

/**
 * Read the contents of a file
 * @param path The path to the file to read
 */
export async function readFileContents(path: string) {
  return readFile(path, "utf-8");
}

/**
 * Write content to a file
 * @param path The path to the file to write
 * @param content The content to write to the file
 */
export async function writeFileContents(path: string, content: string) {
  await writeFile(path, content, "utf-8");
  return `Successfully wrote to ${path}`;
}

/**
 * List files in a directory
 * @param dirPath The path to the directory to list
 */
export async function listDirectory(dirPath: string) {
  return readdir(dirPath);
}

/**
 * Get file statistics including size and modification time
 * @param path The path to the file
 */
export async function getFileStats(path: string) {
  const stats = await stat(path);
  return {
    size: stats.size,
    isDirectory: stats.isDirectory(),
    modified: stats.mtime.toISOString(),
    created: stats.birthtime.toISOString(),
  };
}

/**
 * Count lines in a text file
 * @param path The path to the file
 */
export async function countLines(path: string) {
  const content = await readFile(path, "utf-8");
  return content.split("\n").length;
}


/**
 * Get the current working directory
 * 
 * @uri sys://cwd
 * @mimeType "text/plain"
 */
export async function cwd() {
  return process.cwd();
}

cwd.subscribe = async function*() {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    yield
  }
}


/**
 * Current system time
 * @uri sys://time
 */
export function systemTime() {
  return {
    mimeType: "text/plain",
    text: new Date().toISOString()
  };
}

systemTime.subscribe = async function() {
  await new Promise((resolve) => setTimeout(resolve, 1000))
}


/**
 * All the numbers
 * @param number Which number you want to return
 *
 * @uri sys://numbers/{number}
 * @mimeType text/plain
 */
export function numbers(number: number) {
  return `Your number is ${number}`
}

numbers.list = function() {
  return Array.from({ length: 10 }, (_, i) => `sys://numbers/${i + 1}`
  );
}

