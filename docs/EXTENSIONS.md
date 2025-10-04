# LaskoBOT Extensions (Chrome & Firefox)

## Chrome (Developer mode)
- `chrome://extensions` → Enable Developer mode
- Load unpacked → select `chrome-extension/`
- Click the extension → “Service worker” → Inspect for logs

## Firefox (Temporary add‑on)
- `about:debugging#/runtime/this-firefox` → Load Temporary Add‑on → select `firefox-extension/manifest.json`
- Click “Inspect” to see background console and WebSocket frames

## Firefox (Permanent, dev only)
- `about:config` → `xpinstall.signatures.required = false`
- `about:addons` → gear → “Install Add-on From File…” → select `firefox-extension/manifest.json`

## Behavior
- Both extensions connect to `ws://localhost:8765/session/<instanceId>`
- Per‑session tab routing; Debug events with mapping after each command
- Unified tool names (see TOOLS.md)

## Tips
- Use one extension at a time to avoid aliasing new sessions
- Firefox auto‑reconnects via alarms + online events; allow ~1 minute for recovery

