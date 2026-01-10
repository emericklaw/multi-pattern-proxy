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

// Parse URL_PATTERNS or URL_PATTERN from env
const URL_PATTERNS_ENV = process.env.URL_PATTERNS;
const URL_PATTERN_ENV = process.env.URL_PATTERN;
const USE_POSITIONAL_PARAMS = process.env.USE_POSITIONAL_PARAMS === "true";

// Error handling: cannot use both URL_PATTERNS and URL_PATTERN
if (URL_PATTERNS_ENV && URL_PATTERN_ENV) {
  logError("❌ Cannot use both URL_PATTERNS and URL_PATTERN environment variables. Use only one.");
  process.exit(1);
}

// Error handling: at least one must be provided
if (!URL_PATTERNS_ENV && !URL_PATTERN_ENV) {
  logError("❌ Missing required environment variable: URL_PATTERNS or URL_PATTERN");
  process.exit(1);
}

const URL_PATTERNS = {};

if (URL_PATTERNS_ENV) {
  // Parse multiple patterns: SERVICE=URL,SERVICE2=URL2
  for (const entry of URL_PATTERNS_ENV.split(",")) {
    const [key, url] = entry.split("=");
    if (key && url) URL_PATTERNS[key] = url;
  }
} else if (URL_PATTERN_ENV) {
  // Single pattern: use "DEFAULT" as the service key
  URL_PATTERNS["DEFAULT"] = URL_PATTERN_ENV;
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
    const value = params[key] || "";
    
    // If using positional params and this looks like a path (contains /),
    // don't encode the slashes
    if (USE_POSITIONAL_PARAMS && value.includes('/')) {
      // Split by /, encode each segment, then rejoin with /
      return value.split('/').map(segment => encodeURIComponent(segment)).join('/');
    } else {
      return encodeURIComponent(value);
    }
  });
}

// Helper: check if request matches allow list
function isAllowed(params) {
  if (ALLOWED.length === 0) return true;
  return ALLOWED.some((rule) =>
    Object.entries(rule).every(([k, regex]) => params[k] && regex.test(params[k]))
  );
}
// Helper: process request with given service pattern
async function processRequest(req, res, service, segments) {
  logDebug(`🔄 Processing request for service: ${service}`);
  logDebug(`📝 URL segments:`, segments);
  
  const params = {};
  
  if (USE_POSITIONAL_PARAMS) {
    // Use positional parameters: {1}, {2}, {3}, etc.
    // Get all placeholders from the pattern to determine the highest number
    const placeholders = [...URL_PATTERNS[service].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const numericPlaceholders = placeholders.filter(p => /^\d+$/.test(p)).map(Number).sort((a, b) => a - b);
    const maxPlaceholder = Math.max(...numericPlaceholders);
    
    for (let i = 0; i < segments.length; i++) {
      const paramIndex = i + 1;
      
      // If this is the last (highest numbered) placeholder and there are more segments,
      // join all remaining segments with "/"
      if (paramIndex === maxPlaceholder && i < segments.length - 1) {
        params[paramIndex.toString()] = segments.slice(i).join('/');
        logDebug(`📋 Parameter {${paramIndex}} captures remaining path: ${params[paramIndex.toString()]}`);
        break;
      } else {
        params[paramIndex.toString()] = segments[i];
      }
    }
    logDebug(`📋 Parsed positional parameters:`, params);
  } else {
    // Use named key/value pairs: key/value/key2/value2
    // Check if any parameter has -last suffix (captures remaining segments)
    const placeholders = [...URL_PATTERNS[service].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const hasLastParam = placeholders.some(p => p.endsWith('-last'));
    
    let foundLastParam = false;
    
    for (let i = 0; i < segments.length; i += 2) {
      const key = segments[i];
      
      // If this key ends with -last, capture all remaining segments
      if (key.endsWith('-last') && i + 1 < segments.length) {
        const cleanKey = key.slice(0, -5); // Remove '-last' suffix
        params[cleanKey] = segments.slice(i + 1).join('/');
        logDebug(`📋 Parameter ${cleanKey} captures remaining path: ${params[cleanKey]}`);
        foundLastParam = true;
        break;
      } else if (i + 1 < segments.length) {
        params[key] = segments[i + 1];
      } else {
        // Odd number of segments and we're at the last one
        logWarn(`❌ Missing value for key: ${key}`);
        return res.status(400).json({ error: `Missing value for key: ${key}` });
      }
    }
    
    // Check for odd segments only if we didn't find a -last parameter
    if (!foundLastParam && segments.length % 2 !== 0) {
      logWarn(`❌ Invalid number of URL segments: ${segments.length}`);
      return res.status(400).json({ error: "Invalid number of URL segments" }); 
    }
    
    logDebug(`📋 Parsed named parameters:`, params);
  }

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
}

// Route for single URL_PATTERN (no service name required)
if (URL_PATTERN_ENV) {
  app.get("/*", async (req, res) => {
    const path = req.params[0];
    
    if (!path) {
      logWarn(`❌ Empty path provided`);
      return res.status(400).json({ error: "Path required" });
    }

    // Parse path into key/value pairs
    const segments = path.split("/").filter(s => s); // Remove empty segments
    await processRequest(req, res, "DEFAULT", segments);
  });
}

// Catch all /service/<SERVICE>/key/value/... routes (only for URL_PATTERNS)
if (URL_PATTERNS_ENV) {
  app.get("/service/:service/*", async (req, res) => {
    const service = req.params.service;
    
    if (!URL_PATTERNS[service]) {
      logWarn(`❌ Invalid service requested: ${service}`);
      return res.status(400).json({ error: "Invalid service" });
    }

    // Parse remaining path into key/value pairs
    const segments = req.params[0].split("/");
    await processRequest(req, res, service, segments);
  });
}

app.listen(3000, () => {
  logInfo("✅ Proxy running on port 3000");
  logInfo(`📊 Log level: ${LOG_LEVEL}`);
  logInfo(`🔢 Parameter mode: ${USE_POSITIONAL_PARAMS ? 'Positional ({1}, {2}, {3}, ...)' : 'Named (key/value pairs)'}`);
  logInfo("📚 Available services and their parameters:");
  
  for (const [service, pattern] of Object.entries(URL_PATTERNS)) {
    const placeholders = [...pattern.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    logInfo(`  🔸 ${service}:`);
    logInfo(`     URL pattern: ${pattern}`);
    logInfo(`     Parameters: ${placeholders.length > 0 ? placeholders.join(', ') : 'none'}`);
    
    if (USE_POSITIONAL_PARAMS && placeholders.some(p => /^\d+$/.test(p))) {
      const examplePath = placeholders.filter(p => /^\d+$/.test(p)).map(p => `<value${p}>`).join('/');
      const exampleUrl = URL_PATTERNS_ENV ? `/service/${service}/${examplePath}` : `/${examplePath}`;
      logInfo(`     Example URL: ${exampleUrl}`);
    }
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
