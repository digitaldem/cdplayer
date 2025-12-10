const WebSocket = require('ws');
const { HOST, PORT } = require('./constants');
const eventBus = require('./eventBus');
const driveService = require('./driveService');
const metadataService = require('./metadataService');

const server = new WebSocket.Server({ host: HOST, port: PORT });
server.on('connection', async (ws) => {
  // Setup event handlers
  eventBus.on('status', (status) => ws.send(JSON.stringify({ type: 'status', status })));
  eventBus.on('insert', (metadata) => ws.send(JSON.stringify({ type: 'insert', info: metadata })));
  eventBus.on('eject', () => ws.send(JSON.stringify({ type: 'eject', info: null })));

  // Setup socket message handler
  ws.on('message', async (message) => {
    try {
      const { action } = JSON.parse(message.toString());

      if (action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', result: null }));
      } else if (typeof driveService[action] === 'function') {
        const result = await driveService[action]();
        ws.send(JSON.stringify({ type: action, result }));
      } else if (typeof metadataService[action] === 'function') {
        const result = await metadataService[action]();
        ws.send(JSON.stringify({ type: action, result }));
      } else {
        throw new Error(`Unrecognized action: ${action}`);
      }
    } catch (e) {
      console.info(e.message);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  // Shutdown event handlers
  ws.on('close', () => {
    eventBus.off('status', statusHandler);
    eventBus.off('insert', insertHandler);
    eventBus.off('eject', ejectHandler);
  });

  // Init
  const initialMetadata = await driveService.getMetadata();
  const initialStatus = await driveService.getStatus();
  ws.send(JSON.stringify({ type: 'connect', info: initialMetadata, status: initialStatus }));
});

console.info(`CD CTL player WebSocket server running on ws://${HOST}:${PORT}`);
