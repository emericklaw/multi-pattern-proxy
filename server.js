import express from "express";

const app = express();

// Parse LOG_LEVEL from env (DEBUG, INFO, WARN, ERROR)
const LOG_LEVEL = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const logLevels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const currentLogLevel = logLevels[LOG_LEVEL] ?? logLevels.INFO;

// Logging functions
function getTimestamp() {
  return new Date().toISOString();
}

function logDebug(...args) {
  if (currentLogLevel <= logLevels.DEBUG) console.log(`[${getTimestamp()}] [DEBUG]`, ...args);
}

function logInfo(...args) {
  if (currentLogLevel <= logLevels.INFO) console.log(`[${getTimestamp()}] [INFO]`, ...args);
}

function logWarn(...args) {
  if (currentLogLevel <= logLevels.WARN) console.warn(`[${getTimestamp()}] [WARN]`, ...args);
}

function logError(...args) {
  if (currentLogLevel <= logLevels.ERROR) console.error(`[${getTimestamp()}] [ERROR]`, ...args);
}

// Add request logging middleware
app.use((req, res, next) => {
  logInfo(`${req.method} ${req.url}`);
  next();
});

// Parse URL_PATTERNS from env
const URL_PATTERNS_ENV = process.env.URL_PATTERNS;
if (!URL_PATTERNS_ENV) {
  logError("❌ Missing required environment variable: URL_PATTERNS");
  process.exit(1);
}

const URL_PATTERNS = {};
for (const entry of URL_PATTERNS_ENV.split(",")) {
  const [key, url] = entry.split("=");
  if (key && url) URL_PATTERNS[key] = url;
}

// Parse ALLOWED rules with wildcard regex
const ALLOWED = (process.env.ALLOWED || "")
  .split(",")
  .map((rule) => {
    const parts = rule.split(";").map((kv) => kv.trim());
    const obj = {};
    for (const part of parts) {
      if (part) {
        const [key, value] = part.split("=");
        if (value) {
          const regexValue = value.replace(/\*/g, ".*");
          obj[key] = new RegExp(`^${regexValue}$`);
        }
      }
    }
    return obj;
  })
  .filter((r) => Object.keys(r).length > 0);

// Helper: validate required placeholders
function validatePlaceholders(pattern, params) {
  const placeholders = [...pattern.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  for (const placeholder of placeholders) {
    if (!params[placeholder]) return placeholder;
  }
  return null;
}

// Helper: build URL
function buildUrl(pattern, params) {
  return pattern.replace(/\{(\w+)\}/g, (_, key) => {
    return encodeURIComponent(params[key] || "");
  });
}

// Helper: check if request matches allow list
function isAllowed(params) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.some((rule) =>
    Object.entries(rule).every(([k, regex]) => params[k] && regex.test(params[k]))
  );
}

// Catch all /proxy/service/<SERVICE>/key/value/... routes
app.get("/service/:service/*", async (req, res) => {
  const service = req.params.service;
  logDebug(`🔄 Processing request for service: ${service}`);
  
  if (!URL_PATTERNS[service]) {
    logWarn(`❌ Invalid service requested: ${service}`);
    return res.status(400).json({ error: "Invalid service" });
  }

  // Parse remaining path into key/value pairs
  const segments = req.params[0].split("/"); // ["owner", "vercel", "repository", "next.js", ...]
  logDebug(`📝 URL segments:`, segments);
  
  if (segments.length % 2 !== 0) {
    logWarn(`❌ Invalid number of URL segments: ${segments.length}`);
    return res.status(400).json({ error: "Invalid number of URL segments" });
  }

  const params = {};
  for (let i = 0; i < segments.length; i += 2) {
    params[segments[i]] = segments[i + 1];
  }
  logDebug(`📋 Parsed parameters:`, params);

  // Validate placeholders
  const missing = validatePlaceholders(URL_PATTERNS[service], params);
  if (missing) {
    logWarn(`❌ Missing required parameter: ${missing}`);
    return res.status(400).json({ error: `Missing required parameter: ${missing}` });
  }

  // Allow-list check
  if (!isAllowed(params)) {
    logWarn(`🚫 Request not allowed for parameters:`, params);
    return res.status(403).json({ error: "Request not allowed" });
  }

  // Build target URL
  const targetUrl = buildUrl(URL_PATTERNS[service], params);
  logDebug(`🎯 Target URL: ${targetUrl}`);

  try {
    logDebug(`🌐 Fetching from upstream...`);
    const response = await fetch(targetUrl);
    logDebug(`📡 Upstream response status: ${response.status}`);
    
    if (!response.ok) {
      logError(`❌ Upstream fetch failed with status: ${response.status}`);
      return res.status(response.status).json({ error: "Upstream fetch failed" });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    logDebug(`✅ Successfully fetched ${buffer.length} bytes`);
    logInfo(`✅ Served ${service} request: ${buffer.length} bytes`);
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Content-Type",
      response.headers.get("content-type") || "application/octet-stream"
    );

    if (params.filename) {
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${params.filename}"`
      );
    }

    res.send(buffer);
  } catch (err) {
    logError(`💥 Error fetching target: ${err.message}`);
    res.status(500).json({ error: "Failed to fetch target" });
  }
});

app.listen(3000, () => {
  logInfo("✅ Proxy running on port 3000");
  logInfo(`📊 Log level: ${LOG_LEVEL}`);
  logInfo("📚 Available services and their parameters:");
  
  for (const [service, pattern] of Object.entries(URL_PATTERNS)) {
    const placeholders = [...pattern.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    logInfo(`  🔸 ${service}:`);
    logInfo(`     URL pattern: ${pattern}`);
    logInfo(`     Parameters: ${placeholders.length > 0 ? placeholders.join(', ') : 'none'}`);
  }
  
  if (ALLOWED.length > 0) {
    logInfo("🛡️  Allow-list rules:");
    ALLOWED.forEach((rule, index) => {
      const ruleStr = Object.entries(rule).map(([key, regex]) => `${key}=${regex.source}`).join('; ');
      logInfo(`  🔸 Rule ${index + 1}: ${ruleStr}`);
    });
  } else {
    logInfo("🛡️  Allow-list: All requests allowed (no restrictions)");
  }
});
