const WebSocket = require('ws');
const { HOST, PORT } = require('./constants');
const { DriveService } = require('./driveService');

const drive = new DriveService();
const wss = new WebSocket.Server({ host: HOST, port: PORT });

wss.on('connection', async (ws) => {
  const sendState = async () => {
    ws.send(JSON.stringify({ type: 'state', info: await drive.getInfo(), status: await drive.getStatus() }));
  };
  sendState();

  const insertHandler = info => ws.send(JSON.stringify({ type: 'insert', info }));
  const ejectHandler = () => ws.send(JSON.stringify({ type: 'eject' }));
  const statusHandler = status => ws.send(JSON.stringify({ type: 'status', status }));

  drive.on('insert', insertHandler);
  drive.on('eject', ejectHandler);
  drive.on('status', statusHandler);

  ws.on('message', async (message) => {
    try {
      const { action } = JSON.parse(message.toString());
      if (typeof drive[action] === 'function') await drive[action]();
    } catch (e) {
      // ignore malformed messages
    }
  });

  ws.on('close', () => {
    drive.off('insert', insertHandler);
    drive.off('eject', ejectHandler);
    drive.off('status', statusHandler);
  });
});

console.log(`CD player WebSocket server running on ws://${HOST}:${PORT}`);
