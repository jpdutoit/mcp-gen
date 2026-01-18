/**
 * Chrome DevTools Protocol Example
 *
 * This example demonstrates connecting directly to Chrome's remote debugging port
 * using the devtools-protocol types for full type safety.
 *
 * To use this example:
 * 1. Start Chrome with remote debugging enabled:
 *    - macOS: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *    - Linux: google-chrome --remote-debugging-port=9222
 *    - Windows: chrome.exe --remote-debugging-port=9222
 *
 * 2. The tools will connect to the debugging port and control the browser.
 */

import type Protocol from "devtools-protocol";

// Types for CDP communication
interface CDPMessage {
  id: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

// Connection state
let ws: globalThis.WebSocket | null = null;
let messageId = 0;
const pendingMessages = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

// Track attached sessions (for auto-attached targets like iframes)
const attachedSessions = new Map<string, { targetId: string; url: string }>();
// Map request IDs to their session IDs for cross-frame request body retrieval
const requestSessionMap = new Map<string, string | null>();

// Console and Network capture state (declared here, used later)
interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  url?: string;
  lineNumber?: number;
}

interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  mimeType?: string;
  error?: string;
}

const consoleMessages: ConsoleMessage[] = [];
const networkRequests = new Map<string, NetworkRequest>();

// Handle CDP events for console and network monitoring
// sessionId is null for main target, or a string for attached targets (iframes)
function handleCDPEvent(message: CDPMessage & { method?: string; params?: unknown }, sessionId: string | null = null): void {
  // Handle exceptions
  if (message.method === "Runtime.exceptionThrown" && message.params) {
    const params = message.params as {
      timestamp: number;
      exceptionDetails: {
        exception?: { description?: string };
        text: string;
        url?: string;
        lineNumber?: number;
      };
    };
    consoleMessages.push({
      type: "error",
      text: params.exceptionDetails.exception?.description || params.exceptionDetails.text,
      timestamp: params.timestamp || Date.now(),
      url: params.exceptionDetails.url,
      lineNumber: params.exceptionDetails.lineNumber,
    });
  }

  // Handle Console.messageAdded (legacy console API)
  if (message.method === "Console.messageAdded" && message.params) {
    const params = message.params as {
      message: {
        level: string;
        text: string;
        timestamp: number;
        url?: string;
        line?: number;
      };
    };
    consoleMessages.push({
      type: params.message.level,
      text: params.message.text,
      timestamp: params.message.timestamp || Date.now(),
      url: params.message.url,
      lineNumber: params.message.line,
    });
  }

  // Network: Request started
  if (message.method === "Network.requestWillBeSent" && message.params) {
    const params = message.params as {
      requestId: string;
      request: { url: string; method: string };
      timestamp: number;
    };
    networkRequests.set(params.requestId, {
      requestId: params.requestId,
      url: params.request.url,
      method: params.request.method,
      timestamp: params.timestamp,
    });
    // Track which session this request belongs to (for getResponseBody)
    // Only set if not already set (first event wins - handles redirects)
    if (!requestSessionMap.has(params.requestId)) {
      requestSessionMap.set(params.requestId, sessionId);
    }
  }

  // Network: Response received
  if (message.method === "Network.responseReceived" && message.params) {
    const params = message.params as {
      requestId: string;
      response: {
        url: string;
        status: number;
        statusText: string;
        mimeType: string;
        headers: Record<string, string>;
      };
    };
    let request = networkRequests.get(params.requestId);
    if (!request) {
      // Request ID may have changed - create entry from response data
      request = {
        requestId: params.requestId,
        url: params.response.url,
        method: "GET", // Default, actual method unknown at this point
        timestamp: Date.now(),
      };
      networkRequests.set(params.requestId, request);
      // Track session for this request
      if (!requestSessionMap.has(params.requestId)) {
        requestSessionMap.set(params.requestId, sessionId);
      }
    }
    request.status = params.response.status;
    request.statusText = params.response.statusText;
    request.mimeType = params.response.mimeType;
    request.responseHeaders = params.response.headers;
  }

  // Network: Request failed
  if (message.method === "Network.loadingFailed" && message.params) {
    const params = message.params as { requestId: string; errorText: string };
    let request = networkRequests.get(params.requestId);
    if (!request) {
      // Request ID may have changed - create entry
      request = {
        requestId: params.requestId,
        url: "unknown",
        method: "GET",
        timestamp: Date.now(),
      };
      networkRequests.set(params.requestId, request);
      if (!requestSessionMap.has(params.requestId)) {
        requestSessionMap.set(params.requestId, sessionId);
      }
    }
    request.error = params.errorText;
  }
}

/**
 * Convert a filter pattern with * wildcards to a RegExp
 */
function filterToRegex(filter: string): RegExp {
  // Escape regex special characters except *, then replace * with .*
  const escaped = filter.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*/g, ".*");
  return new RegExp(pattern, "i");
}

/**
 * Get list of available browser targets (tabs/pages)
 * @param port Chrome debugging port (default: 9222)
 * @param filter Optional filter pattern to match against tab title or URL (supports * as wildcard)
 */
export async function listTargets(port: number = 9222, filter?: string): Promise<CDPTarget[]> {
  const response = await fetch(`http://localhost:${port}/json`);
  if (!response.ok) {
    throw new Error(
      `Failed to connect to Chrome on port ${port}. Make sure Chrome is running with --remote-debugging-port=${port}`
    );
  }
  const targets: CDPTarget[] = await response.json();

  if (!filter) {
    return targets;
  }

  const regex = filterToRegex(filter);
  return targets.filter((t) => regex.test(t.title) || regex.test(t.url));
}

/**
 * Connect to a Chrome tab by target ID or URL pattern
 * @param targetIdOrUrl Target ID or URL substring to match
 * @param port Chrome debugging port (default: 9222)
 */
export async function connect(
  targetIdOrUrl: string,
  port: number = 9222
): Promise<{ targetId: string; title: string; url: string }> {
  const targets = await listTargets(port);
  const target = targets.find(
    (t) =>
      t.id === targetIdOrUrl ||
      t.url.includes(targetIdOrUrl) ||
      t.title.includes(targetIdOrUrl)
  );

  if (!target) {
    throw new Error(
      `No target found matching "${targetIdOrUrl}". Available targets: ${targets.map((t) => t.title || t.url).join(", ")}`
    );
  }

  if (!target.webSocketDebuggerUrl) {
    throw new Error(`Target "${target.title}" has no WebSocket debugger URL`);
  }

  // Close existing connection if any
  if (ws) {
    ws.close();
    ws = null;
  }

  // Reset state for new connection
  consoleMessages.length = 0;
  networkRequests.clear();
  attachedSessions.clear();
  requestSessionMap.clear();

  return new Promise((resolve, reject) => {
    ws = new WebSocket(target.webSocketDebuggerUrl!);

    ws.addEventListener("open", async () => {
      // Auto-enable DevTools domains for monitoring
      try {
        await sendCommand("Runtime.enable");
        await sendCommand("Console.enable");
        await sendCommand("Network.enable");
        await sendCommand("Page.enable");
        await sendCommand("DOM.enable");

        // Enable auto-attach to capture network from iframes and other targets
        // flatten: true means events from attached targets come directly with sessionId
        // waitForDebuggerOnStart: true pauses new targets so we can enable Network before they load
        await sendCommand("Target.setAutoAttach", {
          autoAttach: true,
          waitForDebuggerOnStart: true,
          flatten: true,
        });
      } catch {
        // Ignore errors during auto-enable
      }

      resolve({
        targetId: target.id,
        title: target.title,
        url: target.url,
      });
    });

    ws.addEventListener("message", (event) => {
      const message: CDPMessage & { sessionId?: string } = JSON.parse(
        typeof event.data === "string" ? event.data : event.data.toString()
      );

      // Handle Target.attachedToTarget - enable network on the attached session then resume
      if (message.method === "Target.attachedToTarget" && message.params) {
        const params = message.params as {
          sessionId: string;
          targetInfo: { targetId: string; type: string; url: string };
          waitingForDebugger: boolean;
        };
        attachedSessions.set(params.sessionId, {
          targetId: params.targetInfo.targetId,
          url: params.targetInfo.url,
        });
        // Enable network monitoring on the attached target, then resume it
        (async () => {
          try {
            await sendCommandToSession("Network.enable", {}, params.sessionId);
            await sendCommandToSession("Runtime.enable", {}, params.sessionId);
          } catch {
            // Ignore errors enabling domains on attached targets
          }
          // Resume the target if it was paused waiting for debugger
          if (params.waitingForDebugger) {
            sendCommandToSession("Runtime.runIfWaitingForDebugger", {}, params.sessionId).catch(() => {});
          }
        })();
      }

      // Handle Target.detachedFromTarget
      if (message.method === "Target.detachedFromTarget" && message.params) {
        const params = message.params as { sessionId: string };
        attachedSessions.delete(params.sessionId);
      }

      // Handle CDP events for console and network (pass sessionId for tracking)
      handleCDPEvent(message, message.sessionId || null);

      const pending = pendingMessages.get(message.id);
      if (pending) {
        pendingMessages.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result);
        }
      }
    });

    ws.addEventListener("error", () => {
      reject(new Error("WebSocket connection error"));
    });

    ws.addEventListener("close", () => {
      ws = null;
      // Reject all pending messages
      for (const [id, pending] of pendingMessages) {
        pending.reject(new Error("Connection closed"));
        pendingMessages.delete(id);
      }
    });
  });
}

// Helper to send CDP commands
async function sendCommand<T>(method: string, params?: unknown): Promise<T> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected. Use connect() first.");
  }

  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pendingMessages.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    ws!.send(JSON.stringify({ id, method, params }));
  });
}

// Helper to send CDP commands to a specific session (for attached targets like iframes)
async function sendCommandToSession<T>(method: string, params: unknown, sessionId: string): Promise<T> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("Not connected. Use connect() first.");
  }

  const id = ++messageId;
  return new Promise((resolve, reject) => {
    pendingMessages.set(id, {
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    ws!.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

/**
 * Navigate to a URL in the connected tab
 * @param url The URL to navigate to
 */
export async function navigate(
  url: string
): Promise<Protocol.Page.NavigateResponse> {
  return sendCommand<Protocol.Page.NavigateResponse>("Page.navigate", { url });
}

/**
 * Get the current page URL and title
 */
export async function getPageInfo(): Promise<{ url: string; title: string }> {
  const urlResult = await sendCommand<Protocol.Runtime.EvaluateResponse>(
    "Runtime.evaluate",
    { expression: "window.location.href" }
  );

  const titleResult = await sendCommand<Protocol.Runtime.EvaluateResponse>(
    "Runtime.evaluate",
    { expression: "document.title" }
  );

  return {
    url: urlResult.result.value as string,
    title: titleResult.result.value as string,
  };
}

/**
 * Execute JavaScript in the page context.
 * Note: Avoid using `const` or `let` for variable declarations as they cannot be
 * redeclared and will cause errors on subsequent evaluations. Use `var` instead.
 * @param expression JavaScript expression to evaluate
 */
export async function evaluate(expression: string): Promise<{
  type: string;
  value: string;
  description?: string;
}> {
  const result = await sendCommand<Protocol.Runtime.EvaluateResponse>(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }
  );

  if (result.exceptionDetails) {
    throw new Error(
      `Evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`
    );
  }

  // Convert value to string representation for consistent serialization
  // This handles undefined, null, objects, and primitives
  let valueStr: string;
  const val = result.result.value;
  if (val === undefined) {
    valueStr = "undefined";
  } else if (val === null) {
    valueStr = "null";
  } else if (typeof val === "object") {
    valueStr = JSON.stringify(val);
  } else {
    valueStr = String(val);
  }

  return {
    type: result.result.type,
    value: valueStr,
    description: result.result.description,
  };
}

/**
 * Take a screenshot of the current page
 * @param format Image format: jpeg or png (default: png)
 * @param quality JPEG quality 0-100 (default: 80, only for jpeg)
 */
export async function screenshot(
  format: "jpeg" | "png" = "png",
  quality: number = 80
): Promise<{ content: Array<{ type: "image"; data: string; mimeType: string }> }> {
  const params: Protocol.Page.CaptureScreenshotRequest = { format };
  if (format === "jpeg") {
    params.quality = quality;
  }

  const result = await sendCommand<Protocol.Page.CaptureScreenshotResponse>(
    "Page.captureScreenshot",
    params
  );

  return {
    content: [
      {
        type: "image",
        data: result.data,
        mimeType: format === "jpeg" ? "image/jpeg" : "image/png",
      },
    ],
  };
}

/**
 * Click on an element matching a CSS selector
 * @param selector CSS selector for the element to click
 */
export async function click(selector: string): Promise<{ clicked: boolean }> {
  // Get document root
  const doc = await sendCommand<Protocol.DOM.GetDocumentResponse>(
    "DOM.getDocument"
  );

  // Find the element
  const nodeResult = await sendCommand<Protocol.DOM.QuerySelectorResponse>(
    "DOM.querySelector",
    {
      nodeId: doc.root.nodeId,
      selector,
    }
  );

  if (!nodeResult.nodeId) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Get element's bounding box
  const boxModel = await sendCommand<Protocol.DOM.GetBoxModelResponse>(
    "DOM.getBoxModel",
    { nodeId: nodeResult.nodeId }
  );

  const content = boxModel.model.content;
  const x = (content[0] + content[2]) / 2;
  const y = (content[1] + content[5]) / 2;

  // Dispatch click events
  await sendCommand("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });

  await sendCommand("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });

  return { clicked: true };
}

/**
 * Type text into the focused element or an element matching a selector
 * @param text Text to type
 * @param selector Optional CSS selector to focus first
 */
export async function type(
  text: string,
  selector?: string
): Promise<{ typed: boolean }> {
  if (selector) {
    await click(selector);
    // Small delay for focus
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Type each character
  for (const char of text) {
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: char,
    });
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      text: char,
    });
  }

  return { typed: true };
}

/**
 * Wait for an element to appear in the DOM
 * @param selector CSS selector to wait for
 * @param timeout Maximum time to wait in milliseconds (default: 5000)
 */
export async function waitForSelector(
  selector: string,
  timeout: number = 5000
): Promise<{ found: boolean }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const doc = await sendCommand<Protocol.DOM.GetDocumentResponse>(
        "DOM.getDocument"
      );
      const nodeResult = await sendCommand<Protocol.DOM.QuerySelectorResponse>(
        "DOM.querySelector",
        { nodeId: doc.root.nodeId, selector }
      );

      if (nodeResult.nodeId) {
        return { found: true };
      }
    } catch {
      // Element not found yet, continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timeout waiting for selector: ${selector}`);
}

/**
 * Get all cookies from the browser
 */
export async function getCookies(): Promise<Protocol.Network.Cookie[]> {
  const result = await sendCommand<Protocol.Network.GetCookiesResponse>(
    "Network.getCookies"
  );
  return result.cookies;
}

/**
 * Set a cookie in the browser
 * @param name Cookie name
 * @param value Cookie value
 * @param domain Cookie domain (default: current page domain)
 */
export async function setCookie(
  name: string,
  value: string,
  domain?: string
): Promise<{ success: boolean }> {
  const params: Protocol.Network.SetCookieRequest = { name, value };
  if (domain) {
    params.domain = domain;
  }

  const result = await sendCommand<Protocol.Network.SetCookieResponse>(
    "Network.setCookie",
    params
  );

  return { success: result.success };
}

/**
 * Close the current connection to the browser
 */
export async function disconnect(): Promise<{ disconnected: boolean }> {
  if (ws) {
    ws.close();
    ws = null;
  }
  return { disconnected: true };
}

/**
 * Get browser version information
 * @param port Chrome debugging port (default: 9222)
 */
export async function getBrowserVersion(port: number = 9222): Promise<{
  browser: string;
  protocolVersion: string;
  userAgent: string;
  v8Version: string;
  webKitVersion: string;
}> {
  const response = await fetch(`http://localhost:${port}/json/version`);
  if (!response.ok) {
    throw new Error(`Failed to connect to Chrome on port ${port}`);
  }
  const data = await response.json();
  return {
    browser: data.Browser,
    protocolVersion: data["Protocol-Version"],
    userAgent: data["User-Agent"],
    v8Version: data["V8-Version"],
    webKitVersion: data["WebKit-Version"],
  };
}

/**
 * Emulate a mobile device viewport
 * @param width Viewport width (default: 375 for iPhone)
 * @param height Viewport height (default: 812 for iPhone)
 * @param deviceScaleFactor Device pixel ratio (default: 3)
 * @param mobile Whether to emulate mobile (default: true)
 */
export async function emulateDevice(
  width: number = 375,
  height: number = 812,
  deviceScaleFactor: number = 3,
  mobile: boolean = true
): Promise<{ emulated: boolean }> {
  await sendCommand("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor,
    mobile,
  });

  return { emulated: true };
}

/**
 * Clear device emulation and reset to default viewport
 */
export async function clearEmulation(): Promise<{ cleared: boolean }> {
  await sendCommand("Emulation.clearDeviceMetricsOverride");
  return { cleared: true };
}

// ============================================================================
// Console Logging (auto-enabled on connect)
// ============================================================================

/**
 * Get captured console messages and optionally clear them
 * @param clear Whether to clear messages after retrieving (default: false)
 * @param since Only return messages after this timestamp (milliseconds since epoch)
 * @param until Only return messages before this timestamp (milliseconds since epoch)
 */
export async function getConsoleMessages(
  clear: boolean = false,
  since?: number,
  until?: number
): Promise<ConsoleMessage[]> {
  let messages = [...consoleMessages];
  if (since !== undefined) {
    messages = messages.filter((m) => m.timestamp >= since);
  }
  if (until !== undefined) {
    messages = messages.filter((m) => m.timestamp <= until);
  }
  if (clear) {
    consoleMessages.length = 0;
  }
  return messages;
}

// ============================================================================
// Network Logging (auto-enabled on connect)
// ============================================================================

/**
 * Get captured network requests and optionally clear them
 * @param clear Whether to clear requests after retrieving (default: false)
 * @param since Only return requests after this timestamp (milliseconds since epoch)
 * @param until Only return requests before this timestamp (milliseconds since epoch)
 */
export async function getNetworkRequests(
  clear: boolean = false,
  since?: number,
  until?: number
): Promise<NetworkRequest[]> {
  let requests = Array.from(networkRequests.values());
  if (since !== undefined) {
    requests = requests.filter((r) => r.timestamp >= since);
  }
  if (until !== undefined) {
    requests = requests.filter((r) => r.timestamp <= until);
  }
  if (clear) {
    networkRequests.clear();
  }
  return requests;
}

// ============================================================================
// Page Actions
// ============================================================================

/**
 * Reload the current page, and clears console and network logs
 * @param ignoreCache Whether to ignore cache when reloading (default: false)
 */
export async function reload(
  ignoreCache: boolean = false
): Promise<{ reloaded: boolean }> {
  await sendCommand("Page.reload", { ignoreCache });
  networkRequests.clear();
  consoleMessages.length = 0
  return { reloaded: true };
}

// ============================================================================
// Keyboard Events
// ============================================================================

// Key definitions for special keys
const KEY_DEFINITIONS: Record<string, { key: string; code: string; keyCode: number }> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Space: { key: " ", code: "Space", keyCode: 32 },
};

/**
 * Press a keyboard key
 * @param key Key to press (Enter, Tab, Escape, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space, or any single character)
 * @param modifiers Optional modifiers object with shift, ctrl, alt, meta booleans
 */
export async function pressKey(
  key: string,
  modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean }
): Promise<{ pressed: boolean }> {
  const keyDef = KEY_DEFINITIONS[key];
  const modifierFlags =
    (modifiers?.alt ? 1 : 0) |
    (modifiers?.ctrl ? 2 : 0) |
    (modifiers?.meta ? 4 : 0) |
    (modifiers?.shift ? 8 : 0);

  if (keyDef) {
    // Special key
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: modifierFlags,
    });
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: modifierFlags,
    });
  } else {
    // Regular character
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyDown",
      text: key,
      key: key,
      modifiers: modifierFlags,
    });
    await sendCommand("Input.dispatchKeyEvent", {
      type: "keyUp",
      text: key,
      key: key,
      modifiers: modifierFlags,
    });
  }

  return { pressed: true };
}

// ============================================================================
// Scrolling
// ============================================================================

/**
 * Scroll to a specific position on the page
 * @param x Horizontal scroll position in pixels
 * @param y Vertical scroll position in pixels
 * @param smooth Whether to use smooth scrolling (default: false)
 */
export async function scrollTo(
  x: number,
  y: number,
  smooth: boolean = false
): Promise<{ scrolled: boolean }> {
  await sendCommand<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
    expression: `window.scrollTo({ left: ${x}, top: ${y}, behavior: '${smooth ? "smooth" : "instant"}' })`,
    returnByValue: true,
  });
  return { scrolled: true };
}

/**
 * Scroll by a relative amount
 * @param deltaX Horizontal scroll amount in pixels
 * @param deltaY Vertical scroll amount in pixels
 * @param smooth Whether to use smooth scrolling (default: false)
 */
export async function scrollBy(
  deltaX: number,
  deltaY: number,
  smooth: boolean = false
): Promise<{ scrolled: boolean }> {
  await sendCommand<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
    expression: `window.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: '${smooth ? "smooth" : "instant"}' })`,
    returnByValue: true,
  });
  return { scrolled: true };
}

/**
 * Scroll an element into view
 * @param selector CSS selector for the element to scroll into view
 * @param block Vertical alignment: start, center, end, nearest (default: center)
 * @param inline Horizontal alignment: start, center, end, nearest (default: center)
 */
export async function scrollIntoView(
  selector: string,
  block: "start" | "center" | "end" | "nearest" = "center",
  inline: "start" | "center" | "end" | "nearest" = "center"
): Promise<{ scrolled: boolean }> {
  const result = await sendCommand<Protocol.Runtime.EvaluateResponse>(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        el.scrollIntoView({ block: '${block}', inline: '${inline}', behavior: 'instant' });
        return true;
      })()`,
      returnByValue: true,
    }
  );

  if (!result.result.value) {
    throw new Error(`Element not found: ${selector}`);
  }

  return { scrolled: true };
}

/**
 * Get current scroll position
 */
export async function getScrollPosition(): Promise<{ x: number; y: number }> {
  const result = await sendCommand<Protocol.Runtime.EvaluateResponse>(
    "Runtime.evaluate",
    {
      expression: `JSON.stringify({ x: window.scrollX, y: window.scrollY })`,
      returnByValue: true,
    }
  );
  return JSON.parse(result.result.value as string);
}

// ============================================================================
// Resources
// ============================================================================

/**
 * Current page information including URL, title, and full HTML content
 * @resource chrome://page
 * @mimeType text/html
 */
export async function currentPage(): Promise<string> {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return "<!-- Not connected to any page -->";
  }

  try {
    // Get URL and title
    const urlResult = await sendCommand<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      { expression: "window.location.href", returnByValue: true }
    );
    const titleResult = await sendCommand<Protocol.Runtime.EvaluateResponse>(
      "Runtime.evaluate",
      { expression: "document.title", returnByValue: true }
    );

    // Get full HTML
    const doc = await sendCommand<Protocol.DOM.GetDocumentResponse>("DOM.getDocument");
    const htmlResult = await sendCommand<Protocol.DOM.GetOuterHTMLResponse>(
      "DOM.getOuterHTML",
      { nodeId: doc.root.nodeId }
    );

    const url = urlResult.result.value as string;
    const title = titleResult.result.value as string;

    return `<!-- URL: ${url} -->\n<!-- Title: ${title} -->\n${htmlResult.outerHTML}`;
  } catch (e) {
    return `<!-- Error: ${e instanceof Error ? e.message : String(e)} -->`;
  }
}

/**
 * Get the content of a specific network asset by request ID
 * @resource chrome://asset/{requestId}
 * @param requestId The request ID of the asset
 */
export async function asset(requestId: string): Promise<{
  text?: string;
  blob?: string;
  mimeType: string;
}> {
  const request = networkRequests.get(requestId);
  if (!request) {
    throw new Error(`Asset not found: ${requestId}`);
  }

  // Get the session this request belongs to (null for main target, string for iframes)
  const sessionId = requestSessionMap.get(requestId);

  try {
    let response: { body: string; base64Encoded: boolean };
    if (sessionId) {
      // Request was from an attached target (iframe), use session-specific command
      response = await sendCommandToSession<{ body: string; base64Encoded: boolean }>(
        "Network.getResponseBody",
        { requestId },
        sessionId
      );
    } else {
      // Request was from main target
      response = await sendCommand<{ body: string; base64Encoded: boolean }>(
        "Network.getResponseBody",
        { requestId }
      );
    }

    const mimeType = request.mimeType || "application/octet-stream";

    if (response.base64Encoded) {
      return { blob: response.body, mimeType };
    } else {
      return { text: response.body, mimeType };
    }
  } catch (e) {
    const sessionInfo = sessionId ? attachedSessions.get(sessionId) : null;
    throw new Error(
      `Failed to get asset content: ${e instanceof Error ? e.message : String(e)} ` +
      `[requestId: ${requestId}, sessionId: ${sessionId || 'main'}, sessionUrl: ${sessionInfo?.url || 'N/A'}]`
    );
  }
}

// List available assets for the templated resource
asset.list = function () {
  return Array.from(networkRequests.values()).map((req) => {
    const sessionId = requestSessionMap.get(req.requestId);
    const sessionInfo = sessionId ? attachedSessions.get(sessionId) : null;
    return {
      uri: `chrome://asset/${req.requestId}`,
      name: req.url.split("/").pop() || req.url,
      description: `${req.method} ${req.status || "pending"} - ${req.url}${sessionId ? ` [session: ${sessionId.substring(0, 8)}... -> ${sessionInfo?.url || 'unknown'}]` : ' [main]'}`,
      mimeType: req.mimeType || "application/octet-stream",
    };
  });
};
