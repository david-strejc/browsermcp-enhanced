# LaskoBOT Troubleshooting

## No extension connected
- Only one extension (Chrome or Firefox) should be active at a time
- Check daemon: `curl http://127.0.0.1:8765/health`
- Reload the extension (Chrome: Reload; Firefox: Reload Temporary Add‑on)

## Firefox disconnects
- Install permanently or rely on alarms reconnect (1‑minute periodic)
- Online event triggers immediate reconnect
- Badge shows ✓ when connected

## Empty extraction
- Many sites lazy‑load; use `browser_scroll` to 'bottom' (steps 3–5), then re‑query

## Logs
- Daemon: `/tmp/browsermcp-daemon.log`, `/tmp/browsermcp-events.log`
- Chrome: `chrome://extensions` → Inspect background
- Firefox: `about:debugging` → Inspect background → WebSocket frames

