# Hot-Reload with Automatic Reconnection Test

## Setup Complete ✓

1. **Streamable HTTP Transport** - Implemented in `src/index-http.ts`
2. **Systemd Service** - Running as `browsermcp-http.service`
3. **Claude Config** - Updated to use `http://localhost:3000/mcp`

## How It Works

When you edit any `.ts` file in the `src/` directory:

1. Hot-reload detects the change (500ms debounce)
2. Runs `npm run build` automatically
3. Copies `dist/*` to `/home/david/.local/lib/browsermcp-enhanced/dist/`
4. Exits cleanly with code 0
5. **Systemd automatically restarts the service** (RestartSec=3s)
6. **Claude automatically reconnects** (HTTP transport has built-in reconnection)

## Testing Steps

1. User types `/mcp` to reconnect to new config
2. Make a test edit to `src/server.ts` (e.g., change a comment)
3. Wait ~3-5 seconds for:
   - Build
   - Deploy
   - Server exit
   - Systemd restart
   - Claude reconnect
4. Check tools are available with fresh code

## Monitoring

```bash
# Watch systemd logs
journalctl -u browsermcp-http.service -f

# Check service status
systemctl status browsermcp-http.service

# Manual restart if needed
sudo systemctl restart browsermcp-http.service
```

## Version

- MCP SDK: 1.16.0
- BrowserMCP: 1.20.0
- Transport: Streamable HTTP (2025-03-26 spec)