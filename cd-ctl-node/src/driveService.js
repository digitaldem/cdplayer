const fs = require('fs').promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const { PlaybackState } = require('./playbackState');
const eventBus = require('./eventBus');
const { CD_DEVICE } = require('./constants');

class DriveService {
  constructor() {
    // Singleton
    if (DriveService.instance) {
      return DriveService.instance;
    }

    this._isMacOS = (process.platform === 'darwin');
    this._devicePath = null;
    this._deviceLock = false;
    this._ejectCountdown = 0;
    this._mplayer = null;
    this._trackCount = 0;
    this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };
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
          // MacOS will need the actual /dev/diskN
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
          // Can use the cdrom device symlink
          currentDevice = CD_DEVICE;
        }

        toc = (this._isMacOS) ? await this._execCommand('drutil', 'toc') : await this._execCommand('wodim', `dev=${CD_DEVICE}`, '-toc');
        if (toc?.match(/track/i)) {
          const lastTrackMatch = (this._isMacOS) ? toc.match(/Last track:\s+(\d+)/) : toc.match(/first:\s+\d+\s+last\s+(\d+)/);
          this._trackCount = (lastTrackMatch) ? parseInt(lastTrackMatch[1], 10) || 0 : 0;
        } else {
          // No TOC means no disc
          currentDevice = null;
        }
      } catch (err) {
        //console.error(`Error polling device: ${err.message}`);
        toc = null;
        currentDevice = null;
      }

      if (currentDevice && !this._devicePath) {
        // Newly inserted
        if (toc) {
          this._ejectCountdown = 0;
          this._devicePath = currentDevice;
          eventBus.emit('insert', toc);
        }
      } else if (currentDevice && this._devicePath) {
        // No-op
        this._ejectCountdown = 0;
      } else if (!currentDevice && this._devicePath) {
        // Newly removed
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

  _spawnPlayer() {
    if (this._playerPollInterval || !this._devicePath || this._mplayer) {
      return;
    }

    const mplayerParams = [
      '-nogui',
      '-slave',
      '-quiet',
      '-idle',
      '-ao', 'alsa',
      '-cdda', 'speed=4:paranoia=0',
      '-cache', '2048',
      '-cache-min', '1',
      '-cdrom-device', this._devicePath,
    ];
    const mplayerEnv = {
      ...process.env,
      ALSA_CARD: 'Device',
    };
    console.info(`SPAWN mplayer ${mplayerParams.join(' ')}`);
    this._mplayer = spawn('mplayer', mplayerParams, { env: mplayerEnv });
    this._mplayer.stdin.setDefaultEncoding('utf-8');

    let buffer = '';
    this._mplayer.stdout.on('data', (data) => {
      buffer += data.toString();
      let lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        console.debug(line);

        if (line.startsWith('ANS_TIME_POSITION=')) {
          const seconds = parseFloat(line.split('=')[1]);
          if (isNaN(seconds)) {
            this._status.time = '0:00';
          } else {
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            this._status.time = `${m}:${s.toString().padStart(2, '0')}`;
            eventBus.emit('status', this._status);
          }
        } else if (line.startsWith('ANS_ERROR=')) {
          const err = line.split('=')[1] || '';
          if (err === 'PROPERTY_UNAVAILABLE') {
            if (this._status.state === PlaybackState.Playing && this._status.track < this._trackCount) {
              this._status.track++;
              this._status.time = '0:00';
              this._commandPlayer(`loadfile cdda://${this._status.track}`);
              eventBus.emit('status', this._status);
            } else {
              this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };
              eventBus.emit('status', this._status);
            }
          }
        }
      }
    });

    this._mplayer.on('exit', (code, signal) => {
      this._mplayer = null;
      this._stopPlayerPolling();
      this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };
      eventBus.emit('status', this._status);
    });
  }

  _commandPlayer(command) {
    if (this._mplayer) {
      console.info(`STDIN mplayer ${command}`);
      this._mplayer.stdin.write(`${command}\n`);
    }
  }

  _killPlayer() {
    if (this._mplayer) {
      console.info(`KILL mplayer [${this._mplayer.pid}]`);
      this._mplayer.kill();
      this._mplayer = null;
    }
  }

  _startPlayerPolling() {
    this._playerPollInterval = setInterval(() => {
      if (this._mplayer) {
        this._mplayer.stdin.write('get_time_pos\n');
      }
    }, 1000);
  }

  _stopPlayerPolling() {
    if (this._playerPollInterval) {
      clearInterval(this._playerPollInterval);
      this._playerPollInterval = null;
    }
  }

  async _execCommand(...command) {
    const execAsync = promisify(exec);
    try {
      const { stdout, stderr } = await execAsync(command.join(' '));
      if (stderr) {
        console.warn(`StdErr: ${stderr.trim()}`);
      }

      // console.debug(`StdOut: ${stdout.trim()}`);
      return stdout.trim();
    } catch (err) {
      const msg = err.message || '';
      if ((command.includes('wodim') && /Cannot load media/i.test(msg)) || (command.includes('drutil') && /no media present/i.test(msg))) {
        // Suppress no disc in drive when polling with wodim/drutil
        return '';
      }

      console.error(`Error: ${err.message}`);
      throw err;
    }
  }

  async getStatus() {
    return this._status;
  }

  async eject() {
    this._killPlayer();
    this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };

    try {
      for (let i = 0; i < 3; i++) {
        if (this._isMacOS) {
          await this._execCommand('drutil', 'tray', 'eject');
        } else {
          await this._execCommand('eject', this._devicePath);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        if (this._devicePath == null) {
          break;
        }
      }
      return true;
    } catch (err) {
      console.error(`Error ejecting disc: ${err.message}`);
      return false;
    }
  }

  async play() {
    if (!this._mplayer) {
      this._spawnPlayer();
      if (this._status.track === 0) {
        this._status.track = 1;
      }
    }

    if (this._status.state === PlaybackState.Paused) {
      this._commandPlayer('pause');
      this._status.state = PlaybackState.Playing;
      this._startPlayerPolling();
      eventBus.emit('status', this._status);
      return true;
    } else {
      this._commandPlayer(`loadfile cdda://${this._status.track}`);
      this._status.state = PlaybackState.Playing;
      this._startPlayerPolling();
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async pause() {
    if (this._status.state === PlaybackState.Playing) {
      this._commandPlayer('pause');
      this._status.state = PlaybackState.Paused;
      this._stopPlayerPolling();
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async stop() {
    if (this._status.state !== PlaybackState.Stopped) {
      this._commandPlayer('stop');
      this._status.state = PlaybackState.Stopped;
      this._status.time = '0:00';
      this._stopPlayerPolling();
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async next() {
    if (!this._mplayer) {
      this._spawnPlayer();
    }

    if (this._status.track < this._trackCount) {
      this._status.track++;
      this._status.time = '0:00';
      this._commandPlayer(`loadfile cdda://${this._status.track}`);
      if (this._status.state !== PlaybackState.Playing) {
        this._commandPlayer('stop');
      }
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }

  async previous() {
    if (!this._mplayer) {
      this._spawnPlayer();
    }

    if (this._status.track > 1) {
      this._status.track--;
      this._status.time = '0:00';
      this._commandPlayer(`loadfile cdda://${this._status.track}`);
      if (this._status.state !== PlaybackState.Playing) {
        this._commandPlayer('stop');
      }
      eventBus.emit('status', this._status);
      return true;
    }
    return false;
  }
}

module.exports = DriveService.getInstance();
