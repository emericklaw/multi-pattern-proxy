import express from "express";

const app = express();

// Parse URL_PATTERNS from env
const URL_PATTERNS_ENV = process.env.URL_PATTERNS;
if (!URL_PATTERNS_ENV) {
  console.error("❌ Missing required environment variable: URL_PATTERNS");
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
  if (!URL_PATTERNS[service]) {
    return res.status(400).json({ error: "Invalid service" });
  }

  // Parse remaining path into key/value pairs
  const segments = req.params[0].split("/"); // ["owner", "vercel", "repository", "next.js", ...]
  if (segments.length % 2 !== 0) {
    return res.status(400).json({ error: "Invalid number of URL segments" });
  }

  const params = {};
  for (let i = 0; i < segments.length; i += 2) {
    params[segments[i]] = segments[i + 1];
  }

  // Validate placeholders
  const missing = validatePlaceholders(URL_PATTERNS[service], params);
  if (missing) {
    return res.status(400).json({ error: `Missing required parameter: ${missing}` });
  }

  // Allow-list check
  if (!isAllowed(params)) {
    return res.status(403).json({ error: "Request not allowed" });
  }

  // Build target URL
  const targetUrl = buildUrl(URL_PATTERNS[service], params);

  try {
    const response = await fetch(targetUrl);
    if (!response.ok) {
      return res.status(response.status).json({ error: "Upstream fetch failed" });
    }

    const buffer = Buffer.from(await response.arrayBuffer());
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
    res.status(500).json({ error: "Failed to fetch target" });
  }
});

app.listen(3000, () => {
  console.log("✅ Proxy running on port 3000");
  console.log("Available services:", Object.keys(URL_PATTERNS));
});
