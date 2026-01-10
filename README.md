# Multi-Pattern Proxy

A **multi-pattern, wildcard-enabled CORS proxy** that dynamically fetches files from configurable services (GitHub, GitLab, etc.) using path-based parameters. Supports environment-based allow-lists, placeholder validation, and Docker deployment.

---

## Features

* **Multiple URL patterns** for different services (`service` parameter)
* **Single service support** for just one URL pattern
* **Flexible parameter modes:**
  * Named key/value pairs with optional path capture using `-last` suffix
  * Positional parameters with automatic path capture on highest-numbered placeholder
* **Smart URL encoding:** Preserves path structure while properly encoding individual segments
* **Placeholder-based URL construction** (`{owner}`, `{repository}`, `{tag}`, `{filename}`, etc.)
* **Wildcard and regex allow-lists** for security
* **CORS support** for browser requests
* **Comprehensive logging** with configurable log levels
* **Dockerized** for easy deployment
* **Path-based parameters** (`/service/.../key/value/...`)

---

## Environment Variables

* **`URL_PATTERN`** (required unless `URL_PATTERNS` is supplied): URL pattern

  **Example:** `URL_PATTERN="https://github.com/{owner}/{repository}/releases/download/{tag}/{filename}"`

* **`URL_PATTERNS`** (required unless `URL_PATTERN` is supplied): Comma-separated list of service patterns

  **Format:** `SERVICE=PATTERN,SERVICE2=PATTERN2`

  **Example:** `URL_PATTERNS="github=https://github.com/{owner}/{repository}/releases/download/{tag}/{filename},gitlab=https://gitlab.com/{owner}/{repository}/-/releases/{tag}/downloads/{filename}"`

* **`ALLOWED`** (optional): Comma-separated list of allow rules with wildcards (`*`)

  **Format:** `key=value;key=value,...`

  **Example:** `ALLOWED="owner=twbs;repository=bootstrap,owner=facebook;repository=react*"`

* **`USE_POSITIONAL_PARAMS`** (optional): Allows the use of positional parameters `{1}, {2} etc` instead of named key/value pairs in the URL.

  **Value:** true/false

  **Default:** false

  Example:`USE_POSITIONAL_PARAMS=true`

* **`LOG_LEVEL`** (optional): Controls logging verbosity. Default: `INFO`
  * `DEBUG`: Shows all logs including detailed request processing
  * `INFO`: Shows general information and request summaries (default)
  * `WARN`: Shows warnings and errors only
  * `ERROR`: Shows only errors
  
  **Example:** `LOG_LEVEL="DEBUG"`

---

## URL Format

### Using USE_POSITIONAL_PARAMS=false (default)

#### Using URL_PATTERN
`/<key1>/<value1>/<key2>/<value2>/...`

* Path is split into **key/value pairs** corresponding to placeholders in the URL pattern
* Special feature: Use `<key>-last` to capture all remaining path segments as a single value

**Example:**

Pattern: `https://github.com/{owner}/{repository}/releases/download/{tag}/{filename}`

Proxy URL: `/owner/twbs/repository/bootstrap/tag/v5.3.8/filename/bootstrap-5.3.8-dist.zip`

**Example with path capture:**

Pattern: `https://api.example.com/{service}/{path}`

Proxy URL: `/service/files/path-last/docs/api/v1/readme.md` 
(The `path` parameter will contain `docs/api/v1/readme.md`)

#### Using URL_PATTERNS
`/service/<SERVICE>/<key1>/<value1>/<key2>/<value2>/...`

* `service` selects the URL pattern
* Remaining segments are **key/value pairs** corresponding to placeholders in the URL pattern
* Special feature: Use `<key>-last` to capture all remaining path segments as a single value

**Example:**

Pattern: `github=https://github.com/{owner}/{repository}/releases/download/{tag}/{filename}`

Proxy URL: `/service/github/owner/twbs/repository/bootstrap/tag/v5.3.8/filename/bootstrap-5.3.8-dist.zip`

### Using USE_POSITIONAL_PARAMS=true

#### Using URL_PATTERN
`/<value1>/<value2>/...`

* Path is split into **values** corresponding to their positional `{1}, {2} etc` placeholders in the URL pattern
* The highest-numbered placeholder automatically captures all remaining path segments

**Example:**

Pattern: `https://github.com/{1}/{2}/releases/download/{3}/{4}`

Proxy URL: `/twbs/bootstrap/v5.3.8/bootstrap-5.3.8-dist.zip`

**Example with path capture:**

Pattern: `https://api.example.com/{1}/{2}`

Proxy URL: `/files/docs/api/v1/readme.md`
(Parameter `{2}` will contain `docs/api/v1/readme.md`)

#### Using URL_PATTERNS
`/service/<SERVICE>/<value1>/<value2>/...`

* `service` selects the URL pattern
* Remaining segments are **values** corresponding to their positional `{1}, {2} etc` placeholders in the URL pattern
* The highest-numbered placeholder automatically captures all remaining path segments

**Example:**

Pattern: `https://github.com/{1}/{2}/releases/download/{3}/{4}`

Proxy URL: `/service/github/twbs/bootstrap/v5.3.8/bootstrap-5.3.8-dist.zip`

---

## URL Encoding and Path Handling

The proxy automatically handles URL encoding to ensure proper parameter transmission:

* **Single values**: Standard URL encoding is applied (spaces become `%20`, etc.)
* **Path values**: When using positional parameters and a value contains `/` characters, each path segment is encoded individually while preserving the forward slashes
* **Captured paths**: Both the `-last` suffix (named mode) and highest-numbered placeholder (positional mode) properly handle multi-segment paths

**Examples:**
* Single file: `my file.txt` → `my%20file.txt`  
* Path segments: `docs/my file/readme.md` → `docs/my%20file/readme.md`

---

## Docker Usage

### Build the Docker Image

```bash
docker build -t multi-pattern-proxy .
```

### Run with Environment Variables

```bash
docker run -p 3000:3000 \
  -e URL_PATTERNS="github=https://github.com/{owner}/{repository}/releases/download/{tag}/{filename},gitlab=https://gitlab.com/{owner}/{repository}/-/releases/{tag}/downloads/{filename}" \
  -e ALLOWED="owner=twbs;repository=bootstrap,owner=facebook;repository=react*" \
  multi-pattern-proxy
```

### Docker Compose

```yaml
services:
  proxy:
    multi-pattern-proxy: .
    container_name: multi-pattern-proxy
    ports:
      - "3000:3000"
    environment:
      LOG_LEVEL: INFO
      URL_PATTERNS: >
        github=https://github.com/{owner}/{repository}/releases/download/{tag}/{filename},
        gitlab=https://gitlab.com/{owner}/{repository}/-/releases/{tag}/downloads/{filename}
      ALLOWED: >
        owner=twbs;repository=bootstrap,
        owner=facebook;repository=react*
```

Run:
```bash
docker-compose up -d
```

---

## Example Requests

### Named Parameters (default)

* **GitHub file download:**
  ```
  Pattern: github=https://github.com/{owner}/{repository}/releases/download/{tag}/{filename}
  URL: http://localhost:3000/service/github/owner/twbs/repository/bootstrap/tag/v5.3.8/filename/bootstrap-5.3.8-dist.zip
  ```

* **API with path capture:**
  ```
  Pattern: api=https://api.example.com/{service}/{path}
  URL: http://localhost:3000/service/api/service/files/path-last/docs/readme.md
  Result: path parameter = "docs/readme.md"
  ```

### Positional Parameters

* **GitHub with positional params:**
  ```
  Pattern: github=https://github.com/{1}/{2}/releases/download/{3}/{4}
  URL: http://localhost:3000/service/github/twbs/bootstrap/v5.3.8/bootstrap-5.3.8-dist.zip
  ```

* **API with path capture (highest numbered placeholder):**
  ```
  Pattern: api=https://api.example.com/{1}/{2}
  URL: http://localhost:3000/service/api/files/docs/api/v1/readme.md
  Result: {2} parameter = "docs/api/v1/readme.md"
  ```

### Single Service Mode

* **Using URL_PATTERN (no service prefix needed):**
  ```
  Pattern: https://github.com/{owner}/{repository}/archive/{tag}.zip
  URL: http://localhost:3000/owner/facebook/repository/react/tag/v18.2.0
  ```

---

## Development

Install dependencies:
`npm install`

Run locally with hot reload:
`npm run dev`

Run normally:
`npm start`

---

## Notes

* **Error Handling:**
  * Missing required placeholders in the URL pattern will return a `400` error
  * Invalid number of URL segments (when not using path capture) will return a `400` error
  * Requests that do not match allow-list rules will return `403`
  
* **Path Capture:**
  * In **named mode**: Use `<key>-last` to capture all remaining path segments
  * In **positional mode**: The highest-numbered placeholder automatically captures remaining segments
  * Captured paths are properly URL-encoded while preserving directory structure

* **Security:**
  * Supports wildcard (`*`) and regex patterns in allow-list for flexible access control
  * All parameters are validated against the URL pattern before processing

* **Logging:**
  * Set `LOG_LEVEL=DEBUG` to see detailed request processing information
  * Request and response details are logged at appropriate levels
