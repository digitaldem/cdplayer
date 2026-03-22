const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const { PlaybackState } = require('./playbackState');
const eventBus = require('./eventBus');
const { CD_DEVICE, AUDIO_DEVICE, MPV_SOCKET } = require('./constants');

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
    this._trackOffsets = []; // disc-absolute start time in seconds, 0-indexed per track
    this._requestId = 0;
    this._pendingRequests = {};
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
  // TOC parsing
  // ---------------------------------------------------------------------------

  // Returns array of track start times in seconds (0-indexed), e.g. [0, 183.5, 356.2]
  //
  // wodim -toc output:
  //   track:  1 lba:         0 (        0) 00:02:00.00
  //   track:  2 lba:     15327 (    61308) 00:05:24.27
  //   track:lout lba:    123456 ...
  //
  // drutil toc output:
  //   Track  1  Start: 00:02:00  Length: 00:03:24
  _parseTocOffsets(toc) {
    if (this._isMacOS) {
      const offsets = [];
      for (const line of toc.split('\n')) {
        const m = line.match(/Track\s+\d+\s+Start:\s+(\d+):(\d+):(\d+)/i);
        if (m) {
          offsets.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + parseInt(m[3], 10) / 75);
        }
      }
      return offsets;
    }

    // wodim: LBA values at 75 frames/sec
    const offsets = [];
    for (const line of toc.split('\n')) {
      const m = line.match(/track:\s+(\d+)\s+lba:\s+(\d+)/i);
      if (m) {
        offsets.push(parseInt(m[2], 10) / 75);
      }
    }
    return offsets;
  }

  // Given a disc-absolute position in seconds, return 1-based track number
  _trackFromPosition(seconds) {
    if (!this._trackOffsets.length) return 1;
    let track = 1;
    for (let i = 0; i < this._trackOffsets.length; i++) {
      if (seconds >= this._trackOffsets[i]) {
        track = i + 1;
      } else {
        break;
      }
    }
    return Math.min(track, this._trackCount);
  }

  // Track-relative seconds from disc-absolute position
  _trackRelativeTime(discSeconds, track) {
    return Math.max(0, discSeconds - (this._trackOffsets[track - 1] ?? 0));
  }

  // Track length in seconds derived from TOC offsets
  _trackLength(track) {
    const start = this._trackOffsets[track - 1] ?? 0;
    const end = this._trackOffsets[track] ?? this._discLength ?? 0;
    return Math.max(0, end - start);
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
          this._trackOffsets = this._parseTocOffsets(toc);
          console.info(`TOC: ${this._trackCount} tracks, offsets: ${this._trackOffsets.map(o => o.toFixed(1)).join(', ')}`);
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
          this._trackOffsets = [];
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
    if (this._mpv || !this._devicePath) return;

    try { require('fs').unlinkSync(MPV_SOCKET); } catch (_) {}

    const mpvParams = [
      '--no-video',
      '--idle=yes',
      '--quiet',
      `--input-ipc-server=${MPV_SOCKET}`,
      `--audio-device=${AUDIO_DEVICE}`,
      '--audio-buffer=1.0',
      '--cdda-speed=4',
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
    this._ipcObserve('time-pos', 1);
    this._ipcObserve('duration', 2);

    // Load full disc, seek to track 1 start, then pause
    if (this._trackCount > 0) {
      if (this._status.track === 0) this._status.track = 1;
      this._ipcSend('loadfile', ['cdda://', 'replace'])
        .then(() => setTimeout(() => {
          const offset = this._trackOffsets[this._status.track - 1] ?? 0;
          this._ipcSend('seek', [offset, 'absolute'])
            .then(() => setTimeout(() => this._ipcSend('set_property', ['pause', true]), 200));
        }, 300));
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

  // Seek to a track's disc-absolute start offset
  _ipcSeekToTrack(track, paused = false) {
    const offset = this._trackOffsets[track - 1] ?? 0;
    this._status.time = '0:00';
    this._status.length = this._trackLength(track);
    return this._ipcSend('seek', [offset, 'absolute'])
      .then(() => {
        if (paused) {
          return setTimeout(() => this._ipcSend('set_property', ['pause', true]), 100);
        }
      });
  }

  // ---------------------------------------------------------------------------
  // IPC event handler
  // ---------------------------------------------------------------------------

  _handleIpcMessage(msg) {
    if (msg.request_id && this._pendingRequests[msg.request_id]) {
      const resolve = this._pendingRequests[msg.request_id];
      delete this._pendingRequests[msg.request_id];
      resolve(msg.data ?? null);
      return;
    }

    if (msg.event === 'property-change') {
      if (msg.name === 'time-pos' && msg.data != null) {
        const discSeconds = parseFloat(msg.data);
        if (!isNaN(discSeconds)) {
          const track = this._trackFromPosition(discSeconds);
          if (track !== this._status.track) {
            this._status.track = track;
            this._status.length = this._trackLength(track);
          }
          const trackSeconds = this._trackRelativeTime(discSeconds, track);
          const m = Math.floor(trackSeconds / 60);
          const s = Math.floor(trackSeconds % 60);
          this._status.time = `${m}:${s.toString().padStart(2, '0')}`;
          eventBus.emit('status', this._status);
        }
      } else if (msg.name === 'duration' && msg.data != null) {
        const seconds = parseFloat(msg.data);
        if (!isNaN(seconds) && seconds > 0) {
          this._discLength = seconds;
          this._status.length = this._trackLength(this._status.track);
        }
      }
      return;
    }

    if (msg.event === 'end-file' && msg.reason === 'eof') {
      this._status.state = PlaybackState.Stopped;
      this._status.time = '0:00';
      this._stopPositionPolling();
      eventBus.emit('status', this._status);
    }
  }

  // ---------------------------------------------------------------------------
  // Position polling — fallback heartbeat
  // ---------------------------------------------------------------------------

  _startPositionPolling() {
    if (this._positionPollInterval) return;
    this._positionPollInterval = setInterval(() => {
      if (!this._socketReady) return;
      this._ipcSend('get_property', ['time-pos'])
        .then((val) => {
          if (val == null) return;
          const discSeconds = parseFloat(val);
          if (isNaN(discSeconds)) return;
          const track = this._trackFromPosition(discSeconds);
          const trackSeconds = this._trackRelativeTime(discSeconds, track);
          const m = Math.floor(trackSeconds / 60);
          const s = Math.floor(trackSeconds % 60);
          this._status.time = `${m}:${s.toString().padStart(2, '0')}`;
          if (track !== this._status.track) {
            this._status.track = track;
            this._status.length = this._trackLength(track);
          }
          eventBus.emit('status', this._status);
        });
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
  // Public API
  // ---------------------------------------------------------------------------

  async getStatus() {
    return this._status;
  }

  async eject() {
    this._killPlayer();
    this._devicePath = null;
    this._trackCount = 0;
    this._trackOffsets = [];
    this._discLength = 0;
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
        await this._ipcSeekToTrack(this._status.track, false);
        await this._ipcSend('set_property', ['pause', false]);
      }
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
      await this._ipcSend('set_property', ['pause', true]);
      await this._ipcSeekToTrack(this._status.track, true);
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
      const paused = this._status.state !== PlaybackState.Playing;
      await this._ipcSeekToTrack(this._status.track, paused);
      if (!paused) this._startPositionPolling();
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async previous() {
    if (!this._mpv) this._spawnPlayer();

    if (this._status.track > 1) {
      this._status.track--;
      const paused = this._status.state !== PlaybackState.Playing;
      await this._ipcSeekToTrack(this._status.track, paused);
      if (!paused) this._startPositionPolling();
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }
}

module.exports = DriveService.getInstance();
