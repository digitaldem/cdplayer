const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const DiscInfo = require('./discInfo');
const { CD_DEVICE } = require('./constants');
const { execCommand } = require('./execCommand');

function parseCdcdStatus(output) {
  const status = { isPlaying: false, track: 0, time: '0:00' };
  if (!output) return status;
  const playMatch = output.match(/(play|pause)/i);
  status.isPlaying = playMatch ? playMatch[1].toLowerCase() === 'play' : false;
  const trackMatch = output.match(/track\s+(\d+)/i);
  if (trackMatch) status.track = parseInt(trackMatch[1]);
  const timeMatch = output.match(/(\d+:\d+)/);
  if (timeMatch) status.time = timeMatch[1];
  return status;
}

class DriveService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.status = { isPlaying: false, track: 0, time: '0:00' };
    this._monitor = options.monitor !== false;
    this._poll = options.poll !== false;
    if (this._monitor) this._monitorUdev();
    if (this._poll) this._pollStatus();
    this.checkExistingDisc();
  }

  async checkExistingDisc() {
    try {
      await DiscInfo.setMetadata();
      const info = await DiscInfo.getMetadata();
      if (info) this.emit('insert', info);
    } catch {}
  }

  async insert() {
    await DiscInfo.setMetadata();
    const info = await DiscInfo.getMetadata();
    this.emit('insert', info);
  }

  async eject() {
    await execCommand(`eject ${CD_DEVICE}`);
    await DiscInfo.clear();
    this.emit('eject');
  }

  async play() { await execCommand(`mplayer cdda://${CD_DEVICE}`); }
  async pause() { await execCommand('mplayer pause'); }
  async stop() { await execCommand('pkill mplayer'); }
  async next() { await execCommand('mplayer -cd 0 -chapter +1'); }
  async previous() { await execCommand('mplayer -cd 0 -chapter -1'); }

  async getInfo() { return DiscInfo.getMetadata(); }
  async getStatus() { return { ...this.status }; }

  _monitorUdev() {
    const mon = spawn('udevadm', ['monitor', '--udev', '--subsystem-match=block']);
    mon.stdout.on('data', data => {
      const txt = data.toString();
      if (txt.includes('add') && txt.includes(CD_DEVICE)) {
        this.insert().catch(() => {});
      }
      if (txt.includes('remove') && txt.includes(CD_DEVICE)) {
        this.emit('eject');
        DiscInfo.clear().catch(() => {});
      }
    });
  }

  _pollStatus() {
    this._pollInterval = setInterval(async () => {
      try {
        const out = await execCommand('cdcd status');
        this.status = parseCdcdStatus(out);
        this.emit('status', { ...this.status });
      } catch {}
    }, 1000);
  }
}

module.exports = { DriveService, parseCdcdStatus };
