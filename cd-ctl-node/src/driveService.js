const { exec, spawn } = require('child_process');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');

const { CD_DEVICE, SECTOR_OFFSET } = require('./constants');
const metadataService = require('./metadataService');
const PlaybackState = require('./playbackState');

class DriveService extends EventEmitter {
  constructor() {
    super();
    // Singleton
    if (DriveService.instance) {
      return DriveService.instance;
    }

    this._isMacOS = (process.platform === 'darwin');
    this._devicePath = null;
    this._deviceLock = false;
    this._ejectCountdown = 0;
    this._mplayer = null;
    this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };
    this._metadata = null;
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
        if (!toc?.match(/track/i)) {
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
          const [discId, trackCount] = await this._getDiscId(toc);
          this._metadata = discId ? await metadataService.get(discId, trackCount) : null;
          this.emit('insert', this._metadata);
        }
      } else if (currentDevice && this._devicePath) {
        // No-op
        this._ejectCountdown = 0;
      } else if (!currentDevice && this._devicePath) {
        // Newly removed
        this._ejectCountdown++;
        if (this._ejectCountdown >= 3) {
          this._devicePath = null;
          this._metadata = null;
          this.emit('eject');
        }
      }
      this._deviceLock = false;
    }, 2000);
  }

  async _spawnPlayer() {
    if (this._playerPollInterval || !this._devicePath || this._mplayer) {
      return;
    }

    const mplayerParams = [
      '-slave',
      '-quiet',
      '-idle',
      '-nogui',
      '-ao', 'alsa',
      '-cdrom-device', this._devicePath,
    ];
    const mplayerEnv = {
      ...process.env,
      ALSA_CARD: 'Device',
    };
    this._mplayer = spawn('mplayer', mplayerParams, { env: mplayerEnv });

    this._mplayer.stdin.setDefaultEncoding('utf-8');

    let buffer = '';
    this._mplayer.stdout.on('data', (data) => {
      buffer += data.toString();
      let lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('ANS_disc-current-title=')) {
          const track = parseInt(line.split('=')[1], 10) || 0;
          if (track !== this._status.track) {
            this.emit('status', this._status);
          }
        }
        if (line.startsWith('ANS_TIME_POSITION=')) {
          const seconds = parseFloat(line.split('=')[1]);
          if (isNaN(seconds)) {
            this._status.time = '0:00';
          } else {
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            this._status.time = `${m}:${s.toString().padStart(2, '0')}`;
          }
        }
      }
    });

    this._mplayer.on('exit', (code, signal) => {
      this._mplayer = null;
      this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };
      this._stopPlayerPolling();
    });
  }

  async _killPlayer() {
    if (this._mplayer) {
      this._mplayer.kill();
      this._mplayer = null;
    }
  }

  async _startPlayerPolling() {
    this._playerPollInterval = setInterval(() => {
      if (this._mplayer) {
        this._mplayer.stdin.write('get_property disc-current-title\n');
        this._mplayer.stdin.write('get_time_pos\n');
      }
      this.emit('status', this._status);
    }, 1000);
  }

  async _stopPlayerPolling() {
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

      // console.info(`StdOut: ${stdout.trim()}`);
      return stdout.trim();
    } catch (err) {
      const msg = err.message || '';
      if ((cmd.includes('wodim') && /Cannot load media/i.test(msg)) || (cmd.includes('drutil') && /no media present/i.test(msg))) {
        // Suppress no disc in drive when polling with wodim/drutil
        return '';
      }

      console.error(`Error: ${err.message}`);
      throw err;
    }
  }

  async _getDiscId(tocString) {
    // Allocate a filled hex string array of 102 '00000000's
    const tocStringArray = new Array(102).fill('');
    const tocHexArray = new Array(102).fill('0'.repeat(8));

    try {
      // Begin to parse the toc command line output
      for (const tocLine of tocString.split('\n')) {
        const line = tocLine.trim()
        // Find the "First track" line (drutil)
        if (line.startsWith('First track')) {
          // Extract the number and update the first TOC element
          // Note the string length on this element is only 2 bytes,
          // while the remaining sector market elements use all 8 bytes
          const m = line.match(/First track:\s+(\d+)/);
          let number = parseInt(m[1], 10) || 1;
          if (number !== 1) {
            console.warn(`First track listed as ${number} instead of '1'`);
            number = 1;
          };
          tocStringArray[0] = number.toString();
          tocHexArray[0] = number.toString(16).padStart(2, '0').toUpperCase();
          continue;
        }
        // Find the "Last track" line (drutil)
        else if (line.startsWith('Last track')) {
          // Extract the number and update the second TOC element
          // Note the string length on this elements is only 2 bytes,
          // while the remaining sector market elements use all 8 bytes
          const m = line.match(/Last track:\s+(\d+)/);
          const number = parseInt(m[1], 10) || 1;
          tocStringArray[1] = number.toString();
          tocHexArray[1] = number.toString(16).padStart(2, '0').toUpperCase();
          continue;
        }
        // Find the "Lead-out" line (drutil)
        else if (line.startsWith('Lead-out')) {
          // Extract the time and build the LBA sector
          const m = line.match(/Lead-out:\s+(\d+):(\d+)\.(\d+)/);
          const min = parseInt(m[1], 10);
          const sec = parseInt(m[2], 10);
          const frame = parseInt(m[3], 10);
          const lba = (min * 60 + sec) * 75 + frame;
          tocStringArray[2] = lba.toString();
          tocHexArray[2] = lba.toString(16).padStart(8, '0').toUpperCase();
        }
        // Find the remaining "Track" lines (drutil)
        else if (line.indexOf('Track') != -1) {
          // Extract the time and build the LBA sector
          const m = line.match(/Track\s+(\d+):\s+(\d+):(\d+)\.(\d+)/);
          const track = parseInt(m[1], 10);
          const min = parseInt(m[2], 10);
          const sec = parseInt(m[3], 10);
          const frame = parseInt(m[4], 10);
          const lba = (min * 60 + sec) * 75 + frame;
          tocStringArray[track + 2] = lba.toString();
          tocHexArray[track + 2] = lba.toString(16).padStart(8, '0').toUpperCase();
          continue;
        }
        // Find the "first: X last Y" line (wodim)
        else if (line.startsWith('first') && line.indexOf('last') != -1) {
          // Extract the two numbers and update first two TOC elements
          // Note the string length on these elements is only 2 bytes,
          // while the remaining sector market elements use all 8 bytes
          const numbers = line.match(/first:\s+(\d+)\s+last\s+(\d+)/).slice(1).map(x => parseInt(x, 10) || 1);
          if (numbers[0] !== 1) {
            console.warn(`First track listed as ${numbers[0]} instead of '1'`);
            numbers[0] = 1;
          };

          tocStringArray.splice(0, 2, ...numbers.map(x => x.toString()));
          tocHexArray.splice(0, 2, ...numbers.map(x => x.toString(16).padStart(2, '0').toUpperCase()));
          continue;
        }
        // Find the remaining "track:" marker lines (wodim)
        else if (line.startsWith('track') && line.indexOf('lba') != -1) {
          // Extract the track number (will be NaN if the line is for the lead out sequence)
          const [, track, lba] = (line.match(/track:\s*(\d+|lout)\s+lba:\s+(\d+)/) || []).map(x => parseInt(x, 10));
          // Apply the required standard sector offset
          if (Number.isNaN(track)) {
            // Lead out sector is third, immediately after both the first track number and last track number elements
            tocStringArray[2] = (lba + SECTOR_OFFSET).toString();
            tocHexArray[2] = (lba + SECTOR_OFFSET).toString(16).padStart(8, '0').toUpperCase();
          } else {
            // The remaining track LBA sector definitions start after the leadout element
            tocStringArray[track + 2] = (lba + SECTOR_OFFSET).toString();
            tocHexArray[track + 2] = (lba + SECTOR_OFFSET).toString(16).padStart(8, '0').toUpperCase();
          }
        }
      }
    } catch (err) {
      console.error(`Error getting disc ID: ${err.message}`);
      return '';
    }

    // Join the TOC elements into a single string and calculate the SHA-1 hash
    const hash = crypto.createHash('sha1')
                       .update(tocHexArray.join(''))
                       .digest('base64')
                       .replace(/\+/g, '.')
                       .replace(/\//g, '_')
                       .replace(/=/g, '-');

    // Return the hash (discID) and the physical track count (per the TOC data)
    // console.info(tocStringArray.join(' ').trim());
    // console.info(hash);
    return [hash, parseInt(tocStringArray[1], 10) || 0];
  }

  async getStatus() {
    return this._status;
  }

  async getMetadata() {
    return this._metadata;
  }

  async reloadMetadata() {
    try {
      const output = await this._execCommand(
        'git',
        '-C',
        '/home/cduser/cdplayer',
        'pull',
        'origin'
      );
    } catch (err) {
      console.error(`Error on git pull of metadata: ${err.message}`);
    }
  }

  async eject() {
    await this._killPlayer();
    this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };

    try {
      for (let i = 0; i < 3; i++) {
        if (this._isMacOS) {
          await this._execCommand('drutil', 'tray', 'eject');
        } else {
          await this._execCommand('eject', this._devicePath);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
        if (this._metadata == null) {
          break;
        }
      }
      return;
    } catch (err) {
      console.error(`Error ejecting disc: ${err.message}`);
    }
  }

  async play() {
    if (!this._mplayer) {
      await this._spawnPlayer();
      if (this._status.track === 0) {
        this._status.track = 1;
      }
    }

    if (this._status.state === PlaybackState.Paused) {
      this._mplayer?.stdin.write('pause\n');
      this._status.state = PlaybackState.Playing;
      await this._startPlayerPolling();
      this.emit('status', this._status);
    } else if (this._status.state === PlaybackState.Stopped) {
      this._mplayer?.stdin.write(`loadfile cdda://${this._status.track}\n`);
      this._status.state = PlaybackState.Playing;
      await this._startPlayerPolling();
      this.emit('status', this._status);
    }
  }

  async pause() {
    if (this._status.state === PlaybackState.Playing) {
      this._mplayer?.stdin.write('pause\n');
      this._status.state = PlaybackState.Paused;
      await this._stopPlayerPolling();
      this.emit('status', this._status);
    }
  }

  async stop() {
    if (this._status.state !== PlaybackState.Stopped) {
      this._mplayer?.stdin.write('stop\n');
      this._status.state = PlaybackState.Stopped;
      this._status.time = '0:00';
      await this._stopPlayerPolling();
      this.emit('status', this._status);
    }
  }

  async next() {
    this._mplayer?.stdin.write('pt_step 1\n');
    this._status.track++;
    this.emit('status', this._status);
  }

  async previous() {
    this._mplayer?.stdin.write('pt_step -1\n');
    this._status.track--;
    this.emit('status', this._status);
  }
}

module.exports = DriveService.getInstance();
