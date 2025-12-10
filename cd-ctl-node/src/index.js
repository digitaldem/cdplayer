const WebSocket = require('ws');
const { HOST, PORT } = require('./constants');
const eventBus = require('./eventBus');
const driveService = require('./driveService');
const discService = require('./discService');

const server = new WebSocket.Server({ host: HOST, port: PORT });
server.on('connection', async (ws) => {
  // Setup event handlers
  const statusHandler = (status) => ws.send(JSON.stringify({ type: 'status', status }));
  eventBus.on('status', statusHandler);
  const infoHandler = (info) => ws.send(JSON.stringify({ type: 'info', info }));
  eventBus.on('info', infoHandler);
  const insertHandler = (toc) => ws.send(JSON.stringify({ type: 'insert', toc }));
  eventBus.on('insert', insertHandler);
  const ejectHandler = () => ws.send(JSON.stringify({ type: 'eject' }));
  eventBus.on('eject', ejectHandler);

  // Setup socket message handler
  ws.on('message', async (message) => {
    try {
      const { action } = JSON.parse(message.toString());

      if (action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', result: null }));
      } else if (typeof driveService[action] === 'function') {
        const result = await driveService[action]();
        ws.send(JSON.stringify({ type: action, result }));
      } else if (typeof discService[action] === 'function') {
        const result = await discService[action]();
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
    eventBus.off('info', infoHandler);
    eventBus.off('insert', insertHandler);
    eventBus.off('eject', ejectHandler);
  });

  // Init
  ws.send(JSON.stringify({ type: 'connect' }));

  const initialInfo = await discService.getInfo();
  infoHandler(initialInfo);

  const initialStatus = await driveService.getStatus();
  statusHandler(initialStatus);

});

console.info(`CD CTL player WebSocket server running on ws://${HOST}:${PORT}`);
