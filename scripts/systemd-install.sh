#!/usr/bin/env bash
set -euo pipefail

# BrowserMCP Enhanced — systemd installer
# Installs/updates systemd unit files and default env, enables and restarts services.

usage() {
  cat <<EOF
Usage: $0 [options]

Options:
  --user <name>           System user to run services (default: current user)
  --group <name>          System group (default: user's primary group)
  --install-dir <path>    Install directory with dist/ (default: /home/<user>/.local/lib/browsermcp-enhanced)
  --http-port <port>      HTTP MCP port (default: 3000)
  --ws-port <port>        WebSocket daemon port (default: 8765)
  --env-file <path>       Path to /etc/default env file (default: /etc/default/browsermcp)
  --no-restart            Install only; do not restart services
  -h, --help              Show this help

Examples:
  sudo $0 --user david --install-dir /home/david/.local/lib/browsermcp-enhanced
  sudo $0 --http-port 4000 --ws-port 9876
EOF
}

USER_NAME=$(id -un)
GROUP_NAME=$(id -gn)
INSTALL_DIR="/home/${USER_NAME}/\.local/lib/browsermcp-enhanced"
HTTP_PORT=3000
WS_PORT=8765
ENV_FILE="/etc/default/browsermcp"
RESTART=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) USER_NAME="$2"; shift 2 ;;
    --group) GROUP_NAME="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --ws-port) WS_PORT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --no-restart) RESTART=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

HTTP_UNIT_SRC="debian/systemd/browsermcp-http.service"
DAEMON_UNIT_SRC="debian/systemd/browsermcp-daemon.service"

if [[ ! -f "$HTTP_UNIT_SRC" || ! -f "$DAEMON_UNIT_SRC" ]]; then
  echo "Error: systemd unit templates not found (expected debian/systemd/)" >&2
  exit 1
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

# Template replacements for user/group and install dir
for unit in "$HTTP_UNIT_SRC" "$DAEMON_UNIT_SRC"; do
  base=$(basename "$unit")
  sed -e "s|^User=.*$|User=${USER_NAME}|" \
      -e "s|^Group=.*$|Group=${GROUP_NAME}|" \
      -e "s|/home/david/.local/lib/browsermcp-enhanced|${INSTALL_DIR}|g" \
      "$unit" > "$TMPDIR/$base"
done

echo "Installing unit files to /etc/systemd/system";
install -D -m 0644 "$TMPDIR/browsermcp-http.service" /etc/systemd/system/browsermcp-http.service
install -D -m 0644 "$TMPDIR/browsermcp-daemon.service" /etc/systemd/system/browsermcp-daemon.service

# Prepare env file
mkdir -p "$(dirname "$ENV_FILE")"
if [[ ! -f "$ENV_FILE" ]]; then
  install -D -m 0644 debian/default/browsermcp "$ENV_FILE"
fi

# Update ports in env file
sed -i \
  -e "s|^BROWSER_MCP_HTTP_PORT=.*$|BROWSER_MCP_HTTP_PORT=${HTTP_PORT}|" \
  -e "s|^BROWSER_MCP_DAEMON_PORT=.*$|BROWSER_MCP_DAEMON_PORT=${WS_PORT}|" \
  -e "s|^BROWSER_MCP_HTTP_URL=.*$|BROWSER_MCP_HTTP_URL=http://127.0.0.1:${HTTP_PORT}|" \
  "$ENV_FILE"

systemctl daemon-reload
systemctl enable browsermcp-http.service browsermcp-daemon.service

if [[ "$RESTART" -eq 1 ]]; then
  systemctl restart browsermcp-http.service
  systemctl restart browsermcp-daemon.service
fi

echo "Done. Status:";
systemctl --no-pager --full status browsermcp-http.service | sed -n '1,10p'
systemctl --no-pager --full status browsermcp-daemon.service | sed -n '1,10p'

