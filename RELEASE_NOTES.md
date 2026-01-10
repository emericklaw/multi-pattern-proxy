# Release Notes

## v1.2.0 - Enhanced Parameter Handling (2026-01-10)

### 🚀 New Features

- **Path Capture Support**: Added `-last` suffix for named parameters and automatic path capture for highest-numbered positional placeholders
- **Smart URL Encoding**: Path-aware encoding preserves directory structure while properly encoding individual segments

### 🛠️ Improvements

- Enhanced error handling with better validation messages
- Flexible segment validation for path capture scenarios
- Added detailed debug logging for parameter processing

### 🔍 Examples

**Named with path capture:**
```
URL: /service/api/service/files/path-last/docs/readme.md
Result: path="docs/readme.md"
```

**Positional with path capture:**
```
Pattern: {1}/{2}
URL: /assets/images/icons/logo.png  
Result: {2}="images/icons/logo.png"
```

### 📋 Technical Notes

- Fully backward compatible - no breaking changes
- New features are opt-in via `-last` suffix or highest placeholder usage

---

**Commit:** `d1485cd` | **Author:** Matt Emerick-Law | **Date:** January 10, 2026

## v1.1.0 - Positional Parameters & Single Service Mode (2025-09-28)

### 🚀 New Features

- **Positional Parameters**: Added `USE_POSITIONAL_PARAMS` support for numbered placeholders (`{1}`, `{2}`, `{3}`)
- **Single Service Mode**: New `URL_PATTERN` environment variable for single-pattern deployments without service prefixes
- **Flexible Configuration**: Choose between `URL_PATTERNS` (multi-service) or `URL_PATTERN` (single service)

### 🛠️ Improvements

- Refactored parameter processing into reusable `processRequest()` function
- Enhanced startup logging with parameter mode indication
- Added example URL generation for positional parameter patterns
- Improved error handling with mutual exclusion validation

### 🔍 Examples

**Positional parameters:**
```
Pattern: {1}/{2}/{3}/{4}
URL: /service/github/twbs/bootstrap/v5.3.8/bootstrap.zip
Result: {1}="twbs", {2}="bootstrap", {3}="v5.3.8", {4}="bootstrap.zip"
```

**Single service mode:**
```
Pattern: https://github.com/{owner}/{repo}/archive/{tag}.zip
URL: /owner/facebook/repo/react/tag/v18.2.0
```

### 📋 Technical Notes

- Breaking change: Cannot use both `URL_PATTERNS` and `URL_PATTERN` simultaneously
- Positional mode requires numbered placeholders in URL patterns
- Single service mode uses catch-all route without `/service/` prefix

---

**Commit:** `71e559b` | **Author:** Matt Emerick-Law | **Date:** September 28, 2025

## v1.0.0 - Initial Release (2025-09-26)

### 🚀 New Features

- **Multi-Pattern Proxy**: Support for multiple URL patterns via `URL_PATTERNS` environment variable
- **Placeholder System**: Dynamic URL construction using `{placeholder}` syntax
- **Wildcard Allow-lists**: Security filtering with wildcard (`*`) and regex support via `ALLOWED` environment variable
- **CORS Support**: Built-in CORS headers for browser compatibility
- **Docker Support**: Full containerization with multi-platform builds (linux/amd64, linux/arm64)

### 🛠️ Improvements

- **Comprehensive Logging**: Configurable log levels (DEBUG, INFO, WARN, ERROR) with timestamps
- **Request Middleware**: Automatic request logging for all incoming requests
- **Error Handling**: Proper validation and error responses for missing parameters and invalid requests
- **Parameter Validation**: Ensures all required placeholders are provided before making upstream requests

### 🔍 Examples

**Basic multi-service setup:**
```
URL_PATTERNS=github=https://github.com/{owner}/{repo}/releases/download/{tag}/{filename},gitlab=https://gitlab.com/{owner}/{repo}/-/releases/{tag}/downloads/{filename}
URL: /service/github/owner/twbs/repo/bootstrap/tag/v5.3.8/filename/bootstrap.zip
```

**With allow-list security:**
```
ALLOWED=owner=twbs;repo=bootstrap,owner=facebook;repo=react*
```

### 📋 Technical Notes

- Uses named key/value pair URL structure: `/service/<SERVICE>/key/value/key2/value2`
- Environment variables: `URL_PATTERNS` (required), `ALLOWED` (optional), `LOG_LEVEL` (optional)
- Default log level: INFO

---

**Commit:** `58ce809` | **Author:** Matt Emerick-Law | **Date:** September 26, 2025