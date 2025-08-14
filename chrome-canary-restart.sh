#!/bin/bash

# Chrome Canary restart script - targets only Canary processes
# Usage: ./chrome-canary-restart.sh [start|stop|restart]

stop_chrome() {
    echo "Stopping Chrome Canary..."
    
    # Only kill chrome-canary processes, not regular chrome
    pkill -f "/opt/google/chrome-canary/chrome" 2>/dev/null || true
    sleep 1
    
    # Force kill any remaining canary processes
    pkill -9 -f "/opt/google/chrome-canary/chrome" 2>/dev/null || true
    
    echo "Chrome Canary stopped."
}

start_chrome() {
    echo "Starting Chrome Canary..."
    
    # Ensure DISPLAY is set - inherit from current environment or use default
    if [ -z "$DISPLAY" ]; then
        export DISPLAY=:0
    fi
    
    # Start Chrome Canary with proper environment
    DISPLAY=$DISPLAY nohup google-chrome-canary >/dev/null 2>&1 &
    
    # Wait a moment to check if it started
    sleep 2
    
    # Check if Chrome Canary actually started
    if pgrep -f "/opt/google/chrome-canary/chrome" > /dev/null; then
        echo "Chrome Canary started successfully."
    else
        echo "Failed to start Chrome Canary. Trying with explicit display..."
        DISPLAY=:0 google-chrome-canary >/dev/null 2>&1 &
        sleep 2
        if pgrep -f "/opt/google/chrome-canary/chrome" > /dev/null; then
            echo "Chrome Canary started with DISPLAY=:0"
        else
            echo "Error: Failed to start Chrome Canary"
            echo "Try running: DISPLAY=:0 google-chrome-canary"
        fi
    fi
}

case "${1:-restart}" in
    "start")
        start_chrome
        ;;
    "stop") 
        stop_chrome
        ;;
    "restart")
        stop_chrome
        start_chrome
        ;;
    *)
        echo "Usage: $0 [start|stop|restart]"
        exit 1
        ;;
esac