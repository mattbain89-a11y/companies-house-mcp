# Companies House MCP

An MCP server and CLI for looking up UK company information. Search for companies, check who runs them, see their filing history, run due diligence checks — all from Claude or your terminal.

Uses the free [Companies House API](https://developer.company-information.service.gov.uk/). You'll need an API key (takes 30 seconds to register).

## Setup

### Get an API key

Register at [developer.company-information.service.gov.uk](https://developer.company-information.service.gov.uk/) and create an API key. It's free.

### Use with Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "companies-house": {
      "command": "npx",
      "args": ["companies-house-mcp"],
      "env": {
        "COMPANIES_HOUSE_API_KEY": "your-key-here"
      }
    }
  }
}
```

### Use with Claude Code

Add to your project or global settings:

```json
{
  "mcpServers": {
    "companies-house": {
      "command": "npx",
      "args": ["companies-house-mcp"],
      "env": {
        "COMPANIES_HOUSE_API_KEY": "your-key-here"
      }
    }
  }
}
```

A skill file is included with domain expertise for UK company research — company number formats, SIC code interpretation, due diligence workflows, and when to generate visual diagrams from the data.

### Use the CLI

The CLI gives you the same data in your terminal without needing Claude.

```bash
# Save your API key (one time)
npx companies-house-mcp config set-key your-key-here

# Then use it
npx companies-house-mcp search "Anthropic"
npx companies-house-mcp report 14604577
npx companies-house-mcp check 14604577
```

Or install globally for a shorter command:

```bash
npm install -g companies-house-mcp
ch search "Anthropic"
ch report 14604577
```

Three output modes: clean terminal formatting (default), `--md` for markdown, `--json` for piping to other tools.

## What you can do

### Ask Claude

Once the MCP is connected, just ask naturally:

- "Look up Tesco on Companies House"
- "Who are the directors of Anthropic Limited?"
- "Run a due diligence check on company number 14604577"
- "Show me the filing history for BrewDog"
- "What other companies is this director involved with?"
- "Does this company have any outstanding charges?"

### Use the CLI

```
ch search "Anthropic"                     Search companies by name
ch search --status active --sic 62011     Filter by status, SIC code, type
ch profile 14604577                       Company profile
ch officers 14604577                      Current officers
ch officers 14604577 --all                Include resigned officers
ch ownership 14604577                     Who owns/controls the company
ch filings 14604577                       Filing history
ch filings 14604577 --category accounts   Filter filings by category
ch charges 00445790                       Charges and mortgages
ch insolvency 00445790                    Insolvency proceedings
ch report 14604577                        Everything in one call
ch check 14604577                         Due diligence red-flag scan
ch network "John Smith"                   Officer's company connections
ch search-officers "Smith"                Search for officers by name
```

## Tools

17 tools available via MCP.

**Search** — `search_companies`, `search_officers`

**Company data** — `get_company_profile`, `get_officers`, `get_appointments`, `get_ownership`, `get_filings`, `get_charges`, `get_insolvency`, `get_company_registers`

**Composite** — these combine multiple API calls into a single response:
- `company_report` — full company overview (profile, officers, ownership, charges, filings, insolvency)
- `due_diligence_check` — automated red-flag scan with severity ratings
- `officer_network` — map a director's connections across companies

**Extended** — `get_exemptions`, `get_uk_establishments`, `get_officer_disqualifications`, `get_filing_document`

Every tool returns both formatted text (for humans) and structured JSON (for programmatic use).

## API key

The API key can be set in three ways (checked in this order):

1. `--key` flag — `ch profile 00445790 --key your-key`
2. `COMPANIES_HOUSE_API_KEY` environment variable
3. Config file — run `ch config set-key your-key` (saves to `~/.config/companies-house/config.json`)

Run `ch config show` to check which source is active.

## Development

```bash
npm install
npm run build
npm test                    # Unit + integration tests
npm run test:unit           # Unit tests only (no API key needed)
npm run test:integration    # Integration tests (needs API key)
```

## Disclaimer

This project is not affiliated with or endorsed by Companies House or the UK Government. It uses the publicly available [Companies House API](https://developer.company-information.service.gov.uk/).

## License

MIT
