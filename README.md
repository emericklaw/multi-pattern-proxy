# Multi-Pattern Proxy

A **multi-pattern, wildcard-enabled CORS proxy** that dynamically fetches files from configurable services (GitHub, GitLab, etc.) using path-based parameters. Supports environment-based allow-lists, placeholder validation, and Docker deployment.

---

## Features

* Multiple URL patterns for different services (`service` parameter)
* Single service support for just one URL pattern
* Placeholder-based URL construction (`{owner}`, `{repository}`, `{tag}`, `{filename}`, etc.)
* Wildcard and regex allow-lists for security
* CORS support for browser requests
* Dockerized for easy deployment
* Path-based parameters (`/service/.../key/value/...`)

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

**Example:**

Pattern: `https://github.com/{owner}/{repository}/releases/download/{tag}/{filename}`

Proxy URL: `/owner/twbs/repository/bootstrap/tag/v5.3.8/filename/bootstrap-5.3.8-dist.zip`

#### Using URL_PATTERNS
`/service/<SERVICE>/<key1>/<value1>/<key2>/<value2>/...`

* `service` selects the URL pattern
* Remaining segments are **key/value pairs** corresponding to placeholders in the URL pattern

**Example:**

Pattern: `github=https://github.com/{owner}/{repository}/releases/download/{tag}/{filename}`

Proxy URL: `/service/github/owner/twbs/repository/bootstrap/tag/v5.3.8/filename/bootstrap-5.3.8-dist.zip`

### Using USE_POSITIONAL_PARAMS=true

#### Using URL_PATTERN
`/<value1>/<value2>/...`

* Path is split into **values** corresponding to their postional `{1}, {2} etc` placeholders in the URL pattern

**Example:**

Pattern: `https://github.com/{1}/{2}/releases/download/{3}/{4}`

Proxy URL: `/twbs/bootstrap/v5.3.8/bootstrap-5.3.8-dist.zip`

#### Using URL_PATTERNS
`/service/<SERVICE>/<value1>/<value2>/...`

* `service` selects the URL pattern
* Remaining segments are **values** corresponding to their postional `{1}, {2} etc` placeholders in the URL pattern

**Example:**

Pattern: `https://github.com/{1}/{2}/releases/download/{3}/{4}`

Proxy URL: `/service/github/twbs/bootstrap/v5.3.8/bootstrap-5.3.8-dist.zip`

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

* GitHub:
  http://localhost:3000/service/github/owner/twbs/repository/bootstrap/tag/v5.3.8/filename/bootstrap-5.3.8-dist.zip

* GitLab:
  http://localhost:3000/service/gitlab/owner/twbs/repository/bootstrap/tag/v5.3.8/filename/bootstrap-5.3.8-dist.zip

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

* Missing required placeholders in the URL pattern will return a `400` error
* Requests that do not match allow-list rules will return `403`
* Supports wildcard and regex in allow-list for flexible access control
