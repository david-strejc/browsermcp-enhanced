#!/usr/bin/env node
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const PORT = 8765;

// Create HTTP server
const server = createServer();

// Create WebSocket server
const wss = new WebSocketServer({ server });

console.log(`WebSocket server starting on port ${PORT}...`);

// Track connected clients
const clients = new Set();

wss.on('connection', (ws, req) => {
  console.log(`New client connected from ${req.socket.remoteAddress}`);
  clients.add(ws);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to MCP WebSocket bridge',
    timestamp: Date.now()
  }));
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received:', message.type || 'unknown');
      
      // Echo back for now (MCP server will handle actual messages)
      if (message.type === 'ping') {
        ws.send(JSON.stringify({
          id: message.id,
          type: 'pong',
          timestamp: Date.now()
        }));
      }
    } catch (error) {
      console.error('Error parsing message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    clients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

server.listen(PORT, () => {
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down WebSocket server...');
  
  // Close all client connections
  clients.forEach(ws => {
    ws.send(JSON.stringify({
      type: 'shutdown',
      message: 'Server shutting down'
    }));
    ws.close();
  });
  
  // Close server
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});