# Release Notes

## v1.3.0 - Implement Caching (2026-02-02)

### 🚀 New Features

- **File System Caching**: Intelligent caching system with configurable timeouts to improve performance and reduce upstream load
- **Per-Service Cache Control**: Individual cache timeout configuration using `|cache:SECONDS` syntax in URL patterns  
- **Separate File Storage**: Metadata and content stored in separate files for better debugging and maintenance
- **Cache Management API**: Secure REST endpoints for cache invalidation and cleanup using Bearer token authentication
- **Automatic Cache Cleanup**: Background scheduler automatically removes expired cache files to keep storage tidy
- **Cache Headers**: Comprehensive cache timing information in response headers for client optimization

### 🛠️ Improvements

- **Smart Cache Validation**: Files are cached only on successful HTTP 200 responses
- **Detailed Cache Headers**: Added `X-Cache`, `X-Cache-Age`, `X-Cache-Expires-In`, `X-Cache-Expires-At`, and `Cache-Control` headers
- **Secure Cache Management**: API endpoints protected by Authorization Bearer tokens, disabled when no API key provided
- **Cache Directory Structure**: Organized cache storage by service name in `/cache/<SERVICE_NAME>/` directories
- **Configurable Cleanup**: Customizable cleanup intervals via `CACHE_CLEANUP_INTERVAL` environment variable

### 🔍 Examples

**Cache configuration:**
```bash
URL_PATTERNS="github=https://github.com/{owner}/{repo}/releases/download/{tag}/{file}|cache:300,api=https://api.example.com/{path}|cache:600"
CACHE_API_KEY="your-secret-key"
CACHE_CLEANUP_INTERVAL="1800"  # 30 minutes
```

**Cache management:**
```bash
# Invalidate cache for specific service
curl -X DELETE "http://localhost:3000/invalidate-cache/github" \
  -H "Authorization: Bearer your-secret-key"

# Clean up expired files
curl -X POST "http://localhost:3000/cleanup-cache" \
  -H "Authorization: Bearer your-secret-key"
```

**Cache headers:**
```
X-Cache: HIT
X-Cache-Age: 125
X-Cache-Expires-In: 175
X-Cache-Expires-At: 2026-02-02T15:30:45.123Z
Cache-Control: public, max-age=175
```

### 📋 Technical Notes

- Cache files use MD5 hash of target URL as filename for deduplication
- Cache validation checks both content and metadata file existence
- Background cleanup only runs when caching is enabled for at least one service
- Cache management endpoints use standard HTTP authentication (Authorization: Bearer)
- Breaking change: Cache syntax changed from `cache=N` to `cache:N` for better parsing


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
