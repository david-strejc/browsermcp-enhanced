# LaskoBOT Systemd Services

## Install
```bash
sudo ./scripts/systemd-install.sh \
  --user "$USER" \
  --install-dir "/home/$USER/.local/lib/browsermcp-enhanced" \
  --http-port 3000 \
  --ws-port 8765
```

Env file: `/etc/default/browsermcp`
- `BROWSER_MCP_HTTP_PORT=3000`
- `BROWSER_MCP_DAEMON_PORT=8765`
- `BROWSER_MCP_HTTP_URL=http://127.0.0.1:3000`
- `BROWSER_MCP_COMMAND_TIMEOUT=45000`

## Manage
```bash
sudo systemctl status browsermcp-http.service browsermcp-daemon.service
sudo systemctl restart browsermcp-http.service browsermcp-daemon.service
```

Logs:
- `/tmp/browsermcp-daemon.log`
- `/tmp/browsermcp-events.log`

