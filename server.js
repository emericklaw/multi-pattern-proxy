import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const app = express();

// Parse LOG_LEVEL from env (DEBUG, INFO, WARN, ERROR)
const LOG_LEVEL = (process.env.LOG_LEVEL || "INFO").toUpperCase();
const logLevels = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };
const currentLogLevel = logLevels[LOG_LEVEL] ?? logLevels.INFO;

// Parse cache-related environment variables
const CACHE_API_KEY = process.env.CACHE_API_KEY; // Only use if explicitly provided
const CACHE_DIR = "/cache";
const CACHE_CLEANUP_INTERVAL = parseInt(process.env.CACHE_CLEANUP_INTERVAL || "1800", 10); // Default: 30 minutes (1800 seconds)

// Logging functions
function getTimestamp() {
  return new Date().toISOString();
}

function logTrace(...args) {
  if (currentLogLevel <= logLevels.TRACE) console.log(`[${getTimestamp()}] [TRACE]`, ...args);
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
  logTrace(`Request headers:`, req.headers);
  logDebug(`Request path: ${req.path}`);
  logDebug(`Request params:`, req.params);
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

// Parse cache timeouts for each pattern
const CACHE_TIMEOUTS = {};
for (const [service, pattern] of Object.entries(URL_PATTERNS)) {
  CACHE_TIMEOUTS[service] = parseCacheTimeout(pattern);
  URL_PATTERNS[service] = removeCacheFlag(pattern);
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

// Cache utility functions
function ensureCacheDir(service) {
  const serviceDir = path.join(CACHE_DIR, service);
  if (!fs.existsSync(serviceDir)) {
    fs.mkdirSync(serviceDir, { recursive: true });
  }
  return serviceDir;
}

function generateCacheKey(targetUrl, params) {
  const hash = crypto.createHash('md5').update(targetUrl).digest('hex');
  return hash;
}

function getCacheFilePaths(service, cacheKey) {
  const serviceDir = ensureCacheDir(service);
  return {
    content: path.join(serviceDir, `${cacheKey}.cache`),
    metadata: path.join(serviceDir, `${cacheKey}.meta`)
  };
}

function isCacheValid(cacheFilePaths, cacheTimeout) {
  if (!fs.existsSync(cacheFilePaths.content) || !fs.existsSync(cacheFilePaths.metadata)) {
    return false;
  }
  
  const stats = fs.statSync(cacheFilePaths.metadata);
  const ageSeconds = (Date.now() - stats.mtime.getTime()) / 1000;
  return ageSeconds < cacheTimeout;
}

function readCacheFile(cacheFilePaths) {
  try {
    const metadata = JSON.parse(fs.readFileSync(cacheFilePaths.metadata, 'utf8'));
    const content = fs.readFileSync(cacheFilePaths.content);
    return { metadata, content };
  } catch (err) {
    logError(`Error reading cache files: ${err.message}`);
    return null;
  }
}

function writeCacheFile(cacheFilePaths, content, contentType) {
  try {
    const metadata = { contentType, timestamp: Date.now() };
    fs.writeFileSync(cacheFilePaths.metadata, JSON.stringify(metadata, null, 2));
    fs.writeFileSync(cacheFilePaths.content, content);
    logDebug(`📁 Cached files: ${cacheFilePaths.content} and ${cacheFilePaths.metadata}`);
  } catch (err) {
    logError(`Error writing cache files: ${err.message}`);
  }
}

function parseCacheTimeout(pattern) {
  const cacheMatch = pattern.match(/\|cache:(\d+)/);
  if (cacheMatch) {
    return parseInt(cacheMatch[1], 10);
  }
  return 0; // No caching
}

function removeCacheFlag(pattern) {
  return pattern.replace(/\|cache:\d+/, '');
}

// Cache cleanup functions
function cleanExpiredCacheFiles() {
  let totalCleaned = 0;
  
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      return totalCleaned;
    }
    
    const services = fs.readdirSync(CACHE_DIR, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);
    
    for (const service of services) {
      const serviceDir = path.join(CACHE_DIR, service);
      const cacheTimeout = CACHE_TIMEOUTS[service];
      
      // Skip cleanup if no cache timeout is set for this service
      if (!cacheTimeout || cacheTimeout <= 0) {
        continue;
      }
      
      try {
        const files = fs.readdirSync(serviceDir);
        let serviceCleaned = 0;
        
        for (const file of files) {
          if (file.endsWith('.cache')) {
            const baseName = file.slice(0, -6); // Remove .cache extension
            const cacheFilePaths = {
              content: path.join(serviceDir, file),
              metadata: path.join(serviceDir, `${baseName}.meta`)
            };
            
            // Check if cache file is expired
            if (!isCacheValid(cacheFilePaths, cacheTimeout)) {
              // Remove both content and metadata files
              if (fs.existsSync(cacheFilePaths.content)) {
                fs.unlinkSync(cacheFilePaths.content);
              }
              if (fs.existsSync(cacheFilePaths.metadata)) {
                fs.unlinkSync(cacheFilePaths.metadata);
              }
              serviceCleaned++;
              totalCleaned++;
              logDebug(`🗑️ Cleaned expired cache files: ${baseName}`);
            }
          }
        }
        
        if (serviceCleaned > 0) {
          logInfo(`🧹 Cleaned ${serviceCleaned} expired cache files for service: ${service}`);
        }
      } catch (err) {
        logError(`Error cleaning cache for service ${service}: ${err.message}`);
      }
    }
    
    if (totalCleaned > 0) {
      logInfo(`✨ Cache cleanup completed: removed ${totalCleaned} expired files`);
    }
  } catch (err) {
    logError(`Error during cache cleanup: ${err.message}`);
  }
  
  return totalCleaned;
}

function startCacheCleanupScheduler() {
  // Use configurable cleanup interval (convert seconds to milliseconds)
  const CLEANUP_INTERVAL_MS = CACHE_CLEANUP_INTERVAL * 1000;
  
  // Run initial cleanup after 5 minutes
  setTimeout(() => {
    logInfo("🧹 Starting initial cache cleanup...");
    cleanExpiredCacheFiles();
    
    // Then run periodically
    setInterval(() => {
      logDebug("🧹 Running scheduled cache cleanup...");
      cleanExpiredCacheFiles();
    }, CLEANUP_INTERVAL_MS);
    
  }, 5 * 60 * 1000); // 5 minutes delay for initial cleanup
  
  logInfo(`⏰ Cache cleanup scheduler started (runs every ${CACHE_CLEANUP_INTERVAL / 60} minutes)`);
}

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

  const cacheTimeout = CACHE_TIMEOUTS[service];
  const useCache = cacheTimeout > 0;
  
  // Check cache first if caching is enabled
  if (useCache) {
    const cacheKey = generateCacheKey(targetUrl, params);
    const cacheFilePaths = getCacheFilePaths(service, cacheKey);
    
    if (isCacheValid(cacheFilePaths, cacheTimeout)) {
      logDebug(`💾 Serving from cache: ${cacheFilePaths.content}`);
      const cached = readCacheFile(cacheFilePaths);
      if (cached) {
        // Calculate cache timing information
        const cacheAgeSeconds = Math.floor((Date.now() - cached.metadata.timestamp) / 1000);
        const cacheExpiresInSeconds = Math.max(0, cacheTimeout - cacheAgeSeconds);
        const cacheExpiresAt = new Date(cached.metadata.timestamp + (cacheTimeout * 1000));
        
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", cached.metadata.contentType || "application/octet-stream");
        res.setHeader("X-Cache", "HIT");
        res.setHeader("X-Cache-Age", cacheAgeSeconds.toString());
        res.setHeader("X-Cache-Expires-In", cacheExpiresInSeconds.toString());
        res.setHeader("X-Cache-Expires-At", cacheExpiresAt.toISOString());
        res.setHeader("Cache-Control", `public, max-age=${cacheExpiresInSeconds}`);
        
        if (params.filename) {
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${params.filename}"`
          );
        }
        
        logInfo(`✅ Served ${service} request from cache: ${cached.content.length} bytes (age: ${cacheAgeSeconds}s, expires in: ${cacheExpiresInSeconds}s)`);
        return res.send(cached.content);
      }
    }
  }

  try {
    logDebug(`🌐 Fetching from upstream...`);
    const response = await fetch(targetUrl);
    logDebug(`📡 Upstream response status: ${response.status}`);
    
    if (!response.ok) {
      logError(`❌ Upstream fetch failed with status: ${response.status}`);
      return res.status(response.status).json({ error: "Upstream fetch failed" });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || "application/octet-stream";
    logDebug(`✅ Successfully fetched ${buffer.length} bytes`);
    
    // Cache the response if caching is enabled and response is 200
    if (useCache && response.status === 200) {
      const cacheKey = generateCacheKey(targetUrl, params);
      const cacheFilePaths = getCacheFilePaths(service, cacheKey);
      writeCacheFile(cacheFilePaths, buffer, contentType);
    }
    
    logInfo(`✅ Served ${service} request: ${buffer.length} bytes`);
    
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", contentType);
    
    // Add cache headers based on cache state
    if (useCache) {
      res.setHeader("X-Cache", "MISS");
      res.setHeader("X-Cache-Age", "0");
      res.setHeader("X-Cache-Expires-In", cacheTimeout.toString());
      res.setHeader("X-Cache-Expires-At", new Date(Date.now() + (cacheTimeout * 1000)).toISOString());
      res.setHeader("Cache-Control", `public, max-age=${cacheTimeout}`);
    } else {
      res.setHeader("X-Cache", "DISABLED");
      res.setHeader("Cache-Control", "no-cache");
    }

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

// Cache management endpoints (only if CACHE_API_KEY is provided)
if (CACHE_API_KEY) {
  // Cache invalidation endpoint
  app.delete('/invalidate-cache/:service', async (req, res) => {
    const { service } = req.params;
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logWarn(`🚫 Missing or invalid Authorization header`);
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    
    const apiKey = authHeader.slice(7); // Remove 'Bearer ' prefix
    
    if (apiKey !== CACHE_API_KEY) {
      logWarn(`🚫 Invalid API key for cache invalidation`);
      return res.status(401).json({ error: "Invalid API key" });
    }
    
    if (!URL_PATTERNS[service]) {
      logWarn(`❌ Invalid service for cache invalidation: ${service}`);
      return res.status(400).json({ error: "Invalid service" });
    }
    
    try {
      const serviceDir = path.join(CACHE_DIR, service);
      if (fs.existsSync(serviceDir)) {
        const files = fs.readdirSync(serviceDir);
        let deletedCount = 0;
        
        for (const file of files) {
          if (file.endsWith('.cache')) {
            const baseName = file.slice(0, -6); // Remove .cache extension
            const contentFile = path.join(serviceDir, file);
            const metadataFile = path.join(serviceDir, `${baseName}.meta`);
            
            if (fs.existsSync(contentFile)) {
              fs.unlinkSync(contentFile);
            }
            if (fs.existsSync(metadataFile)) {
              fs.unlinkSync(metadataFile);
            }
            deletedCount++;
          }
        }
        
        logInfo(`🗑️ Invalidated ${deletedCount} cache files for service: ${service}`);
        res.json({ 
          success: true, 
          message: `Invalidated ${deletedCount} cache files for service: ${service}`,
          deletedFiles: deletedCount
        });
      } else {
        res.json({ 
          success: true, 
          message: `No cache files found for service: ${service}`,
          deletedFiles: 0
        });
      }
    } catch (err) {
      logError(`💥 Error invalidating cache for service ${service}: ${err.message}`);
      res.status(500).json({ error: "Failed to invalidate cache" });
    }
  });

  // Cache cleanup endpoint - manually trigger cleanup of expired files
  app.post('/cleanup-cache', async (req, res) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logWarn(`🚫 Missing or invalid Authorization header`);
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }
    
    const apiKey = authHeader.slice(7); // Remove 'Bearer ' prefix
    
    if (apiKey !== CACHE_API_KEY) {
      logWarn(`🚫 Invalid API key for cache cleanup`);
      return res.status(401).json({ error: "Invalid API key" });
    }
    
    try {
      logInfo("🧹 Manual cache cleanup triggered via API");
      const cleanedCount = cleanExpiredCacheFiles();
      res.json({
        success: true,
        message: `Cache cleanup completed: removed ${cleanedCount} expired files`,
        cleanedFiles: cleanedCount
      });
    } catch (err) {
      logError(`💥 Error during manual cache cleanup: ${err.message}`);
      res.status(500).json({ error: "Failed to cleanup cache" });
    }
  });
}

app.listen(3000, () => {
  logInfo("✅ Proxy running on port 3000");
  logInfo(`📊 Log level: ${LOG_LEVEL}`);
  logInfo(`🔢 Parameter mode: ${USE_POSITIONAL_PARAMS ? 'Positional ({1}, {2}, {3}, ...)' : 'Named (key/value pairs)'}`);
  logInfo(`💾 Cache directory: ${CACHE_DIR}`);
  
  // Check if any services have caching enabled
  const cachingEnabled = Object.values(CACHE_TIMEOUTS).some(timeout => timeout > 0);
  
  if (CACHE_API_KEY) {
    logInfo(`🔐 Cache management API key: ${CACHE_API_KEY.slice(0, 4)}***`);
    logInfo("🔧 Cache management endpoints enabled");
  } else {
    logInfo("🚫 Cache management disabled (no CACHE_API_KEY provided)");
  }
  
  if (cachingEnabled) {
    startCacheCleanupScheduler();
  } else {
    logInfo("🚫 Cache cleanup disabled (no services have caching enabled)");
  }
  
  logInfo("📚 Available services and their parameters:");
  
  for (const [service, pattern] of Object.entries(URL_PATTERNS)) {
    const placeholders = [...pattern.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const cacheTimeout = CACHE_TIMEOUTS[service];
    logInfo(`  🔸 ${service}:`);
    logInfo(`     URL pattern: ${pattern}`);
    logInfo(`     Parameters: ${placeholders.length > 0 ? placeholders.join(', ') : 'none'}`);
    logInfo(`     Cache timeout: ${cacheTimeout > 0 ? `${cacheTimeout} seconds` : 'disabled'}`);
    
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
