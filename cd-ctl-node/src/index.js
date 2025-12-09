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
        ws.send(JSON.stringify({ type: 'pong', result: null }));
      } else if (typeof driveService[action] === 'function') {
        const result = await driveService[action]();
        ws.send(JSON.stringify({ type: action, result }));
      } else {
        throw new Error(`Unrecognized action: ${action}`);
      }
    } catch (e) {
      console.info(e.message);
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
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
