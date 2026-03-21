const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const { PlaybackState } = require('./playbackState');
const eventBus = require('./eventBus');
const { CD_DEVICE } = require('./constants');

const MPV_SOCKET = '/tmp/mpv-cd-socket';

class DriveService {
  constructor() {
    if (DriveService.instance) {
      return DriveService.instance;
    }

    this._isMacOS = (process.platform === 'darwin');
    this._devicePath = null;
    this._deviceLock = false;
    this._ejectCountdown = 0;
    this._mpv = null;
    this._socket = null;
    this._socketReady = false;
    this._trackCount = 0;
    this._requestId = 0;
    this._pendingRequests = {};
    this._isAdvancing = false;
    this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00', length: 0 };

    DriveService.instance = this;

    (async () => {
      await this._startDevicePolling();
    })();
  }

  static getInstance() {
    if (!DriveService.instance) {
      new DriveService();
    }
    return DriveService.instance;
  }

  // ---------------------------------------------------------------------------
  // Device polling
  // ---------------------------------------------------------------------------

  async _startDevicePolling() {
    this._devicePollInterval = setInterval(async () => {
      if (this._deviceLock || this._status.state !== PlaybackState.Stopped) {
        return;
      }
      this._deviceLock = true;

      let toc = null;
      let currentDevice = null;
      try {
        if (this._isMacOS) {
          const list = await this._execCommand('diskutil', 'list');
          const deviceBlocks = list.split(/\n(?=\/dev\/disk\d+)/);
          for (const block of deviceBlocks) {
            if (block.includes('(external, physical)') && /Audio CD/i.test(block)) {
              const match = block.match(/^(\/dev\/disk\d+)/);
              if (match) {
                currentDevice = match[1];
                break;
              }
            }
          }
        } else {
          currentDevice = CD_DEVICE;
        }

        toc = this._isMacOS
          ? await this._execCommand('drutil', 'toc')
          : await this._execCommand('wodim', `dev=${CD_DEVICE}`, '-toc');

        if (toc?.match(/track/i)) {
          const lastTrackMatch = this._isMacOS
            ? toc.match(/Last track:\s+(\d+)/)
            : toc.match(/first:\s+\d+\s+last\s+(\d+)/);
          this._trackCount = lastTrackMatch ? parseInt(lastTrackMatch[1], 10) || 0 : 0;
        } else {
          currentDevice = null;
        }
      } catch (err) {
        toc = null;
        currentDevice = null;
      }

      if (currentDevice && !this._devicePath) {
        if (toc) {
          this._ejectCountdown = 0;
          this._devicePath = currentDevice;
          this._spawnPlayer();
          eventBus.emit('insert', toc);
        }
      } else if (currentDevice && this._devicePath) {
        this._ejectCountdown = 0;
      } else if (!currentDevice && this._devicePath) {
        this._ejectCountdown++;
        if (this._ejectCountdown >= 3) {
          this._devicePath = null;
          this._trackCount = 0;
          eventBus.emit('eject');
        }
      }

      this._deviceLock = false;
    }, 2000);
  }

  // ---------------------------------------------------------------------------
  // mpv lifecycle
  // ---------------------------------------------------------------------------

  _spawnPlayer() {
    if (this._mpv || !this._devicePath) {
      return;
    }

    // Remove stale socket if present
    try { require('fs').unlinkSync(MPV_SOCKET); } catch (_) {}

    const mpvParams = [
      '--no-video',
      '--idle=yes',
      '--quiet',
      `--input-ipc-server=${MPV_SOCKET}`,
      '--audio-device=pipewire/alsa_output.usb-BurrBrown_from_Texas_Instruments_USB_AUDIO_DAC-00.analog-stereo',
      '--audio-buffer=1.0',
      `--cdda-speed=4`,
      '--cdda-paranoia=1',
      `--cdrom-device=${this._devicePath}`,
    ];

    console.info(`SPAWN mpv ${mpvParams.join(' ')}`);
    this._mpv = spawn('mpv', mpvParams);

    this._mpv.stderr.on('data', (data) => {
      console.debug(`MPV STDERR ${data.toString().trim()}`);
    });

    this._mpv.on('exit', (code, signal) => {
      console.debug(`MPV exit code=${code} signal=${signal}`);
      this._mpv = null;
      this._teardownSocket();
      this._stopPositionPolling();
      this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00', length: 0 };
      eventBus.emit('status', this._status);
    });

    // Give mpv a moment to create the socket
    setTimeout(() => this._connectSocket(), 500);
  }

  _killPlayer() {
    if (this._mpv) {
      console.info(`KILL mpv [${this._mpv.pid}]`);
      this._mpv.kill();
      this._mpv = null;
    }
    this._teardownSocket();
    this._stopPositionPolling();
  }

  // ---------------------------------------------------------------------------
  // IPC socket
  // ---------------------------------------------------------------------------

  _connectSocket(attempt = 0) {
    if (this._socket) return;

    const sock = net.createConnection(MPV_SOCKET);
    let lineBuffer = '';

    sock.on('connect', () => {
      console.info('MPV IPC socket connected');
      this._socket = sock;
      this._socketReady = true;
      this._onSocketReady();
    });

    sock.on('data', (data) => {
      lineBuffer += data.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this._handleIpcMessage(JSON.parse(line));
        } catch (e) {
          console.warn(`MPV IPC parse error: ${line}`);
        }
      }
    });

    sock.on('error', (err) => {
      this._socket = null;
      this._socketReady = false;
      if (attempt < 10) {
        setTimeout(() => this._connectSocket(attempt + 1), 300);
      } else {
        console.error(`MPV IPC socket failed after ${attempt} attempts: ${err.message}`);
      }
    });

    sock.on('close', () => {
      this._socket = null;
      this._socketReady = false;
    });
  }

  _teardownSocket() {
    if (this._socket) {
      this._socket.destroy();
      this._socket = null;
    }
    this._socketReady = false;
    this._pendingRequests = {};
  }

  _onSocketReady() {
    // Observe the events we care about
    this._ipcObserve('time-pos', 1);
    this._ipcObserve('duration', 2);
    this._ipcObserve('end-file', 3);

    // Pre-load track 1 in paused state so play() is instant
    if (this._trackCount > 0) {
      if (this._status.track === 0) this._status.track = 1;
      this._ipcLoadTrack(this._status.track, true);
    }
  }

  // ---------------------------------------------------------------------------
  // IPC messaging
  // ---------------------------------------------------------------------------

  _ipcSend(command, args = []) {
    if (!this._socketReady || !this._socket) return Promise.resolve(null);

    return new Promise((resolve) => {
      const id = ++this._requestId;
      this._pendingRequests[id] = resolve;
      const msg = JSON.stringify({ command: [command, ...args], request_id: id }) + '\n';
      console.debug(`IPC SEND ${msg.trim()}`);
      this._socket.write(msg);

      // Timeout safety — resolve with null if mpv never responds
      setTimeout(() => {
        if (this._pendingRequests[id]) {
          delete this._pendingRequests[id];
          resolve(null);
        }
      }, 3000);
    });
  }

  _ipcObserve(property, id) {
    if (!this._socketReady || !this._socket) return;
    const msg = JSON.stringify({ command: ['observe_property', id, property] }) + '\n';
    this._socket.write(msg);
  }

  _ipcLoadTrack(track, paused = false) {
    this._isAdvancing = false;
    this._status.length = 0;
    this._status.time = '0:00';
    // loadfile cdda://N replace [options]
    const flags = paused ? 'replace' : 'replace';
    return this._ipcSend('loadfile', [`cdda://${track}`, flags])
      .then(() => {
        if (paused) {
          // Set pause=yes after a short settle — mpv needs to open the file first
          setTimeout(() => this._ipcSend('set_property', ['pause', true]), 200);
        }
      });
  }

  // ---------------------------------------------------------------------------
  // IPC event handler
  // ---------------------------------------------------------------------------

  _handleIpcMessage(msg) {
    // Response to a request_id
    if (msg.request_id && this._pendingRequests[msg.request_id]) {
      const resolve = this._pendingRequests[msg.request_id];
      delete this._pendingRequests[msg.request_id];
      resolve(msg.data ?? null);
      return;
    }

    // Property change events
    if (msg.event === 'property-change') {
      if (msg.name === 'time-pos' && msg.data != null) {
        const seconds = parseFloat(msg.data);
        if (!isNaN(seconds)) {
          const m = Math.floor(seconds / 60);
          const s = Math.floor(seconds % 60);
          this._status.time = `${m}:${s.toString().padStart(2, '0')}`;
          eventBus.emit('status', this._status);

          // Auto-advance: within 1 second of end
          if (
            !this._isAdvancing &&
            this._status.length > 0 &&
            seconds >= this._status.length - 1.0 &&
            this._status.track < this._trackCount &&
            this._status.state === PlaybackState.Playing
          ) {
            this._isAdvancing = true;
            this._status.track++;
            this._ipcLoadTrack(this._status.track, false);
          }
        }
      } else if (msg.name === 'duration' && msg.data != null) {
        const seconds = parseFloat(msg.data);
        if (!isNaN(seconds) && seconds > 0) {
          this._status.length = seconds;
          this._isAdvancing = false; // new track fully loaded — safe to advance again
        }
      }
      return;
    }

    // End of file event (track finished naturally)
    if (msg.event === 'end-file') {
      if (msg.reason === 'eof' && !this._isAdvancing) {
        if (this._status.track < this._trackCount && this._status.state === PlaybackState.Playing) {
          this._isAdvancing = true;
          this._status.track++;
          this._ipcLoadTrack(this._status.track, false);
        } else if (this._status.track >= this._trackCount) {
          // End of disc
          this._status.state = PlaybackState.Stopped;
          this._status.time = '0:00';
          this._stopPositionPolling();
          eventBus.emit('status', this._status);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Position polling (mpv pushes time-pos via observe_property so this is just
  // a fallback heartbeat to keep status fresh when the property event is quiet)
  // ---------------------------------------------------------------------------

  _startPositionPolling() {
    if (this._positionPollInterval) return;
    this._positionPollInterval = setInterval(() => {
      if (this._socketReady) {
        this._ipcSend('get_property', ['time-pos'])
          .then((val) => {
            if (val != null) {
              const seconds = parseFloat(val);
              if (!isNaN(seconds)) {
                const m = Math.floor(seconds / 60);
                const s = Math.floor(seconds % 60);
                this._status.time = `${m}:${s.toString().padStart(2, '0')}`;
                eventBus.emit('status', this._status);
              }
            }
          });
      }
    }, 1000);
  }

  _stopPositionPolling() {
    if (this._positionPollInterval) {
      clearInterval(this._positionPollInterval);
      this._positionPollInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async _execCommand(...command) {
    const execAsync = promisify(exec);
    try {
      const { stdout, stderr } = await execAsync(command.join(' '));
      if (stderr) console.warn(`StdErr: ${stderr.trim()}`);
      return stdout.trim();
    } catch (err) {
      const msg = err.message || '';
      if (
        (command.includes('wodim') && /Cannot load media/i.test(msg)) ||
        (command.includes('drutil') && /no media present/i.test(msg))
      ) {
        return '';
      }
      console.error(`Error: ${err.message}`);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — identical surface to original DriveService
  // ---------------------------------------------------------------------------

  async getStatus() {
    return this._status;
  }

  async eject() {
    this._killPlayer();
    this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00', length: 0 };

    try {
      for (let i = 0; i < 3; i++) {
        if (this._isMacOS) {
          await this._execCommand('drutil', 'tray', 'eject');
        } else {
          await this._execCommand('eject', this._devicePath);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        if (this._devicePath == null) break;
      }
      return true;
    } catch (err) {
      console.error(`Error ejecting disc: ${err.message}`);
      return false;
    }
  }

  async play() {
    if (!this._mpv) this._spawnPlayer();

    if (this._status.track === 0) this._status.track = 1;

    if (this._status.state === PlaybackState.Paused) {
      await this._ipcSend('set_property', ['pause', false]);
      this._status.state = PlaybackState.Playing;
      this._startPositionPolling();
      eventBus.emit('status', this._status);
      return true;
    }

    if (this._status.state === PlaybackState.Stopped) {
      if (this._socketReady) {
        await this._ipcLoadTrack(this._status.track, false);
      }
      // else _onSocketReady will handle it once socket connects
      this._status.state = PlaybackState.Playing;
      this._startPositionPolling();
      eventBus.emit('status', this._status);
      return true;
    }

    return false;
  }

  async pause() {
    if (this._status.state === PlaybackState.Playing) {
      await this._ipcSend('set_property', ['pause', true]);
      this._status.state = PlaybackState.Paused;
      this._stopPositionPolling();
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async stop() {
    if (this._status.state !== PlaybackState.Stopped) {
      await this._ipcSend('stop');
      this._status.state = PlaybackState.Stopped;
      this._status.time = '0:00';
      this._stopPositionPolling();
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async next() {
    if (!this._mpv) this._spawnPlayer();

    if (this._status.track < this._trackCount) {
      this._status.track++;
      await this._ipcLoadTrack(this._status.track, this._status.state !== PlaybackState.Playing);
      if (this._status.state === PlaybackState.Playing) {
        this._startPositionPolling();
      }
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async previous() {
    if (!this._mpv) this._spawnPlayer();

    if (this._status.track > 1) {
      this._status.track--;
      await this._ipcLoadTrack(this._status.track, this._status.state !== PlaybackState.Playing);
      if (this._status.state === PlaybackState.Playing) {
        this._startPositionPolling();
      }
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }
}

module.exports = DriveService.getInstance();
