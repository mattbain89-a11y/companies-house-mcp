# MCP setup

The MCP server connects AI assistants to live Companies House data. 18 tools for search, company profiles, officers, filings, charges, insolvency, and due diligence — including direct document downloads.

## Get an API key

Register at [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk/) — free, takes about 30 seconds.

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "companies-house": {
      "command": "npx",
      "args": ["-y", "companies-house-mcp"],
      "env": {
        "COMPANIES_HOUSE_API_KEY": "your-key-here"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add --transport stdio --env COMPANIES_HOUSE_API_KEY=your-key-here companies-house -- npx -y companies-house-mcp
```

Or add to `~/.claude.json` manually:

```json
{
  "mcpServers": {
    "companies-house": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "companies-house-mcp"],
      "env": {
        "COMPANIES_HOUSE_API_KEY": "your-key-here"
      }
    }
  }
}
```

## Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "companies-house": {
      "command": "npx",
      "args": ["-y", "companies-house-mcp"],
      "env": {
        "COMPANIES_HOUSE_API_KEY": "your-key-here"
      }
    }
  }
}
```

## Zed

Add to `~/.config/zed/settings.json`:

```json
{
  "context_servers": {
    "companies-house": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "companies-house-mcp"],
      "env": {
        "COMPANIES_HOUSE_API_KEY": "your-key-here"
      }
    }
  }
}
```

## HTTP mode

The server can run as a Streamable HTTP server instead of stdio. This is useful when you want to share a single server instance across multiple clients, expose it over a network, or connect Claude Desktop via its Custom Connector UI.

Start with `--http` (default port 3000):

```bash
COMPANIES_HOUSE_API_KEY=your-key \
MCP_BEARER_TOKEN=a-secret-token \
npx companies-house-mcp --http
```

Or with a custom port:

```bash
npx companies-house-mcp --http --port 8080
```

Three endpoints are available in HTTP mode:

| Endpoint | Purpose |
|----------|---------|
| `POST /mcp` | MCP protocol — send tool calls here |
| `GET /health` | Health check, returns tool count and OAuth status |
| `GET /.well-known/oauth-authorization-server` | OAuth discovery metadata (when OAuth is enabled) |

### Authentication and environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `COMPANIES_HOUSE_API_KEY` | Yes | API key from developer.company-information.service.gov.uk |
| `MCP_BEARER_TOKEN` | Recommended in HTTP mode | Bearer token required on all `/mcp` requests. Log a warning at startup if unset |
| `MCP_OAUTH_CLIENT_ID` | Optional | Enables OAuth — must be set together with `MCP_OAUTH_CLIENT_SECRET` |
| `MCP_OAUTH_CLIENT_SECRET` | Optional | Paired with `MCP_OAUTH_CLIENT_ID` |
| `MCP_PUBLIC_URL` | Optional | Override the issuer URL in OAuth discovery (required when behind a tunnel or reverse proxy) |
| `COMPANIES_HOUSE_DOWNLOAD_DIR` | Optional | Default save directory for `download_filing_document` in `file_path` mode |

### Connecting Claude Desktop via Custom Connector

Claude Desktop's Custom Connector UI uses an `authorization_code + PKCE` OAuth flow. The server handles the full flow when OAuth env vars are set.

**Requirements:** the server must be publicly reachable — claude.ai's backend makes a back-channel request to `/oauth/token` to exchange the code for a token. Use a tunnel (e.g. Cloudflare Tunnel) for local testing.

**Setup:**

1. Choose a `client_id` and `client_secret` (any strings you control):
   ```bash
   export MCP_OAUTH_CLIENT_ID=my-connector
   export MCP_OAUTH_CLIENT_SECRET=a-long-random-secret
   export MCP_BEARER_TOKEN=a-long-random-token
   export MCP_PUBLIC_URL=https://your-tunnel-url.example.com
   ```

2. Start the server:
   ```bash
   COMPANIES_HOUSE_API_KEY=your-key npx companies-house-mcp --http
   ```

3. Expose via tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

4. In Claude Desktop: **Settings → Integrations → Add Custom Connector**, enter `https://your-tunnel-url.example.com/mcp`.

5. Complete the browser auth flow. Claude Desktop will redirect to `/oauth/authorize`, which immediately redirects back with an auth code (no login UI — the correct `client_id` is sufficient for this single-user server). The token exchange happens in the background.

6. Ask Claude Desktop to call a tool (e.g. "Search for Tesco on Companies House") to confirm it's working.

**Discovering the client_id:** if you're unsure what `client_id` Claude Desktop will send, start the server with any value, watch the logs for the incoming request to `/oauth/authorize`, and update `MCP_OAUTH_CLIENT_ID` to match.

## What to ask

Once connected, ask naturally:

- "Look up Tesco on Companies House"
- "Who are the directors of Anthropic Limited?"
- "Run a due diligence check on company 07670541"
- "Show me the filing history for BrewDog"
- "What other companies is this director involved with?"
- "Does this company have any outstanding charges?"
- "Map the ownership structure of this holding company"
- "Are there any insolvency proceedings against this company?"

## Tools

18 tools available. See the [full tools reference →](/tools).

## CLI

For terminal access without an AI assistant, install [`companies-house-cli`](https://www.npmjs.com/package/companies-house-cli). See the [CLI reference →](/cli).
