const WebSocket = require('ws');
const { HOST, PORT } = require('./constants');
const driveService = require('./driveService');

const server = new WebSocket.Server({ host: HOST, port: PORT });

server.on('connection', async (ws) => {
  const statusHandler = (status) => ws.send(JSON.stringify({ type: 'status', status }));
  driveService.on('status', statusHandler);

  const insertHandler = (metadata) => ws.send(JSON.stringify({ type: 'insert', info: metadata }));
  driveService.on('insert', insertHandler);

  const ejectHandler = () => ws.send(JSON.stringify({ type: 'eject', info: null }));
  driveService.on('eject', ejectHandler);

  ws.on('message', async (message) => {
    try {
      const { action } = JSON.parse(message.toString());

      if (action === 'ping') {
        ws.send(JSON.stringify({ type: action, message: 'pong' }));
      } else if (typeof driveService[action] === 'function') {
        const result = await driveService[action]();
        if (result != null) {
          ws.send(JSON.stringify({ type: action, result }));
        }
      } else {
        const message = `Unrecognized action: ${action}`;
        console.info(message);
        ws.send(JSON.stringify({ type: 'error', message }));
      }
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    driveService.off('status', statusHandler);
    driveService.off('insert', insertHandler);
    driveService.off('eject', ejectHandler);
  });

  const initialMetadata = await driveService.getMetadata();
  const initialStatus = await driveService.getStatus();
  ws.send(JSON.stringify({ type: 'connect', info: initialMetadata, status: initialStatus }));

});

console.info(`CD CTL player WebSocket server running on ws://${HOST}:${PORT}`);
