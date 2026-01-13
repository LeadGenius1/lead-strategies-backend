/**
 * WebSocket Handler for Real-Time Dashboard Updates
 * AI Lead Strategies LLC
 *
 * Pushes live updates to connected dashboard clients
 */

const WebSocket = require('ws');
const { eventBus, CHANNELS } = require('../shared/EventBus');
const { createLogger } = require('../utils/logger');
const { getSystem } = require('../index');

const logger = createLogger('WebSocket');

// Connected clients
const clients = new Set();

// Message types
const MESSAGE_TYPES = {
  HEALTH: 'HEALTH',
  ALERT: 'ALERT',
  METRIC: 'METRIC',
  REPAIR: 'REPAIR',
  PREDICTION: 'PREDICTION',
  SECURITY: 'SECURITY',
  AGENT_STATUS: 'AGENT_STATUS',
  PATTERN: 'PATTERN'
};

/**
 * Initialize WebSocket server
 */
function initializeWebSocket(server) {
  const wss = new WebSocket.Server({
    server,
    path: '/system/live'
  });

  wss.on('connection', (ws, req) => {
    // Get client info
    const clientId = generateClientId();
    const clientIp = req.socket.remoteAddress;

    logger.info('Dashboard client connected', { clientId, ip: clientIp });

    // Add to clients set
    clients.add(ws);
    ws.clientId = clientId;
    ws.isAlive = true;

    // Send initial state
    sendInitialState(ws);

    // Handle pong (heartbeat response)
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // Handle messages from client
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        handleClientMessage(ws, data);
      } catch (error) {
        logger.warn('Invalid message from client', { clientId, error: error.message });
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      clients.delete(ws);
      logger.info('Dashboard client disconnected', { clientId });
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket error', { clientId, error: error.message });
      clients.delete(ws);
    });
  });

  // Heartbeat interval (every 30 seconds)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Subscribe to EventBus for real-time updates
  subscribeToEvents();

  // Periodic health broadcast (every 5 seconds)
  const healthInterval = setInterval(() => {
    broadcastHealth();
  }, 5000);

  // Cleanup on server close
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    clearInterval(healthInterval);
  });

  logger.info('WebSocket server initialized at /system/live');

  return wss;
}

/**
 * Generate unique client ID
 */
function generateClientId() {
  return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Send initial state to new client
 */
async function sendInitialState(ws) {
  try {
    const system = getSystem();
    const summary = system.getHealthSummary();

    send(ws, {
      type: 'INITIAL_STATE',
      data: {
        ...summary,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Failed to send initial state', { error: error.message });
  }
}

/**
 * Handle messages from client
 */
function handleClientMessage(ws, data) {
  switch (data.type) {
    case 'SUBSCRIBE':
      // Client wants specific updates
      ws.subscriptions = data.channels || [];
      break;

    case 'PING':
      send(ws, { type: 'PONG', timestamp: Date.now() });
      break;

    case 'REQUEST_HEALTH':
      sendInitialState(ws);
      break;

    default:
      logger.debug('Unknown message type', { type: data.type });
  }
}

/**
 * Subscribe to EventBus events
 */
function subscribeToEvents() {
  // Alert events
  eventBus.subscribe(CHANNELS.ALERT, (event) => {
    broadcast({
      type: MESSAGE_TYPES.ALERT,
      data: event.data,
      timestamp: event.timestamp
    });
  }, 'WebSocket');

  // Metric events (throttled)
  let lastMetricBroadcast = 0;
  eventBus.subscribe(CHANNELS.METRIC, (event) => {
    const now = Date.now();
    if (now - lastMetricBroadcast > 1000) { // Max 1 per second
      broadcast({
        type: MESSAGE_TYPES.METRIC,
        data: event.data,
        timestamp: event.timestamp
      });
      lastMetricBroadcast = now;
    }
  }, 'WebSocket');

  // Repair events
  eventBus.subscribe(CHANNELS.REPAIR_COMPLETE, (event) => {
    broadcast({
      type: MESSAGE_TYPES.REPAIR,
      data: event.data,
      timestamp: event.timestamp
    });
  }, 'WebSocket');

  // Prediction events
  eventBus.subscribe(CHANNELS.PREDICTION, (event) => {
    broadcast({
      type: MESSAGE_TYPES.PREDICTION,
      data: event.data,
      timestamp: event.timestamp
    });
  }, 'WebSocket');

  // Security events
  eventBus.subscribe(CHANNELS.THREAT_DETECTED, (event) => {
    broadcast({
      type: MESSAGE_TYPES.SECURITY,
      data: event.data,
      timestamp: event.timestamp
    });
  }, 'WebSocket');

  // Agent status events
  eventBus.subscribe(CHANNELS.AGENT_STARTED, (event) => {
    broadcast({
      type: MESSAGE_TYPES.AGENT_STATUS,
      data: { ...event.data, status: 'started' },
      timestamp: event.timestamp
    });
  }, 'WebSocket');

  eventBus.subscribe(CHANNELS.AGENT_STOPPED, (event) => {
    broadcast({
      type: MESSAGE_TYPES.AGENT_STATUS,
      data: { ...event.data, status: 'stopped' },
      timestamp: event.timestamp
    });
  }, 'WebSocket');

  // Pattern learned events
  eventBus.subscribe(CHANNELS.PATTERN_LEARNED, (event) => {
    broadcast({
      type: MESSAGE_TYPES.PATTERN,
      data: event.data,
      timestamp: event.timestamp
    });
  }, 'WebSocket');

  logger.info('Subscribed to EventBus for real-time updates');
}

/**
 * Broadcast health status
 */
function broadcastHealth() {
  try {
    const system = getSystem();
    if (!system.running) return;

    const health = system.getHealthSummary();

    broadcast({
      type: MESSAGE_TYPES.HEALTH,
      data: health,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // System may not be fully initialized
  }
}

/**
 * Send message to single client
 */
function send(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send message', { error: error.message });
    }
  }
}

/**
 * Broadcast message to all connected clients
 */
function broadcast(message) {
  const messageStr = JSON.stringify(message);

  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        // Check if client is subscribed to this type
        if (!ws.subscriptions || ws.subscriptions.length === 0 || ws.subscriptions.includes(message.type)) {
          ws.send(messageStr);
        }
      } catch (error) {
        logger.error('Failed to broadcast to client', { clientId: ws.clientId, error: error.message });
      }
    }
  });
}

/**
 * Get connected client count
 */
function getClientCount() {
  return clients.size;
}

/**
 * Get client info
 */
function getClientInfo() {
  return Array.from(clients).map(ws => ({
    id: ws.clientId,
    subscriptions: ws.subscriptions || [],
    isAlive: ws.isAlive
  }));
}

module.exports = {
  initializeWebSocket,
  broadcast,
  getClientCount,
  getClientInfo,
  MESSAGE_TYPES
};
