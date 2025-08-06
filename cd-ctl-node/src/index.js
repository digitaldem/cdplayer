const WebSocket = require('ws');
const { HOST, PORT } = require('./constants');
const driveService = require('./driveService');

const server = new WebSocket.Server({ host: HOST, port: PORT });

server.on('connection', async (ws) => {
  const sendState = async () => ws.send(JSON.stringify({ type: 'state', metadata: await driveService.getMetadata(), status: await driveService.getStatus() }));

  sendState();

  const insertHandler = metadata => ws.send(JSON.stringify({ type: 'insert', metadata }));
  const ejectHandler = () => ws.send(JSON.stringify({ type: 'eject' }));
  const statusHandler = status => ws.send(JSON.stringify({ type: 'status', status }));

  driveService.on('insert', insertHandler);
  driveService.on('eject', ejectHandler);
  driveService.on('status', statusHandler);

  ws.on('message', async (message) => {
    try {
      const { action } = JSON.parse(message.toString());
      if (typeof driveService[action] === 'function') await driveService[action]();
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    driveService.off('insert', insertHandler);
    driveService.off('eject', ejectHandler);
    driveService.off('status', statusHandler);
  });
});

console.log(`CD CTL player WebSocket server running on ws://${HOST}:${PORT}`);
