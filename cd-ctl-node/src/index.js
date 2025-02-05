const express = require('express');
const cors = require('cors');
const { HOST, PORT } = require('./constants');
const handlers = require('./handlers');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST'], allowedHeaders: ['Content-Type'] }));
app.get('/info', handlers.info);
app.post('/play', handlers.play);
app.post('/pause', handlers.pause);
app.post('/stop', handlers.stop);
app.post('/next', handlers.next);
app.post('/previous', handlers.previous);
app.post('/eject', handlers.eject);
app.listen(PORT, HOST, () => {
  console.log(`CD player API running on http://${HOST}:${PORT}`);
});
