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
        toc = (this._isMacOS) ? await this._execCommand('drutil', 'toc') : await this._execCommand('wodim', `dev=${CD_DEVICE}`, '-toc');
        if (toc?.match(/track/i)) {
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
            // Use cdrom device symlink
            currentDevice = CD_DEVICE;
          }
        }
      } catch (err) {
        //console.error(`Error polling device: ${err.message}`);
        toc = null;
        currentDevice = null;
      }

      if (currentDevice && !this._devicePath) {
        // Newly inserted
        console.log(`Inserted: ${toc}`);
        if (toc) {
          this._ejectCountdown = 0;
          this._devicePath = currentDevice;
          const discId = await this._getDiscId(toc);
          this._metadata = discId ? await metadataService.get(discId) : null;
          this.emit('insert', this._metadata);
        }
      } else if (currentDevice && this._devicePath) {
        // No-op
        this._ejectCountdown = 0;
      } else if (!currentDevice && this._devicePath) {
        // Newly removed
        console.log('Ejected');
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
    if (this._playerPollInterval || !this._devicePath) {
      return;
    }

    const mplayerParams = ['-slave', '-quiet', '-idle', '-cdrom-device', this._devicePath];
    this._mplayer = spawn('mplayer', mplayerParams);
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
        throw new Error(stderr);
      }
      // console.info(`StdOut: ${stdout.trim()}`);
      return stdout.trim();
    } catch (error) {
      console.error(`StdErr: ${error.message}`);
    }
  }

  async _getDiscId(tocString) {
    // Allocate a filled hex string array of 102 '00000000's
    const tocHexArray = new Array(102).fill('0'.repeat(8));

    try {
      // Begin to parse the toc command line output
      for (const tocLine of tocString.split('\n')) {
        const line = tocLine.trim()
        // Find the "First track" line (drutil)
        if (line.startsWith('First track:')) {
          // Extract the number and update the first TOC element
          // Note the string length on these elements is only 2 bytes,
          // while the remaining sector market elements use 8 bytes
          tocHexArray[0] = parseInt(line.match(/First track:\s+(\d+)/)[1], 10).toString(16).padStart(2, '0').toUpperCase();
          continue;
        }
        // Find the "Last track" line (drutil)
        else if (line.startsWith('Last track:')) {
          // Extract the number and update the second TOC element
          // Note the string length on these elements is only 2 bytes,
          // while the remaining sector market elements use 8 bytes
          tocHexArray[1] = parseInt(line.match(/Last track:\s+(\d+)/)[1], 10).toString(16).padStart(2, '0').toUpperCase();
          continue;
        }
        // Find the "Lead-out" line (drutil)
        else if (line.startsWith('Lead-out:')) {
          // Extract the time and build the LBA
          const m = line.match(/Lead-out:\s+(\d+):(\d+)\.(\d+)/);
          const min = parseInt(m[1], 10);
          const sec = parseInt(m[2], 10);
          const frame = parseInt(m[3], 10);
          const lba = (min * 60 + sec) * 75 + frame;
          tocHexArray[2] = lba.toString(16).padStart(8, '0').toUpperCase();
        }
        // Find the "Track" lines (drutil)
        else if (line.indexOf('Track') != -1) {
          // Extract the time and build the LBA
          const m = line.match(/Track\s+(\d+):\s+(\d+):(\d+)\.(\d+)/);
          const track = parseInt(m[1], 10);
          const min = parseInt(m[2], 10);
          const sec = parseInt(m[3], 10);
          const frame = parseInt(m[4], 10);
          const lba = (min * 60 + sec) * 75 + frame;
          tocHexArray[track + 2] = lba.toString(16).padStart(8, '0').toUpperCase();
          continue;
        }
        // Find the "first: X last Y" line (wodim)
        else if (line.startsWith('first:') && line.trim().indexOf('last:') != -1) {
          // Extract the two numbers and update first two TOC elements
          // Note the string length on these elements is only 2 bytes,
          // while the remaining sector market elements use 8 bytes
          tocHexArray.splice(0, 2, ...line.match(/first:\s+(\d+)\s+last\s+(\d+)/).slice(1).map(x => parseInt(x, 10).toString(16).padStart(2, '0').toUpperCase()));
          continue;
        }
        // Find the "track:" marker lines (wodim)
        else if (line.startsWith('track:')) {
          // Extract the track number (or lead out sequence)
          const [, trackNum, offset] = line.match(/track:\s*(\d+|lout)\s+lba:\s+(\d+)/) || [];
          // Apply a required standard sector offset
          const offsetHex = (parseInt(offset) + SECTOR_OFFSET).toString(16).padStart(8, '0').toUpperCase();
          if (trackNum === 'lout') {
            // Lead out sector is after both the first track number and last track number elements
            tocHexArray[2] = offsetHex;
          } else {
            // Then the actual track sector definitions start after the leadout sector element
            tocHexArray[parseInt(trackNum) + 2] = offsetHex;
          }
        }
      }
    } catch (error) {
      console.error(`Error getting disc ID: ${error.message}`);
      return '';
    }

    //console.log(toc.join('\n'));

    // Join the TOC elements into a single string and calculate the SHA-1 hash
    return crypto.createHash('sha1')
                 .update(tocHexArray.join(''))
                 .digest('base64')
                 .replace(/\+/g, '.')
                 .replace(/\//g, '_')
                 .replace(/=/g, '-');
  }

  async getStatus() {
    return this._status;
  }

  async getMetadata() {
    return this._metadata;
  }

  async eject() {
    await this._killPlayer();
    this._status = { state: PlaybackState.Stopped, track: 0, time: '0:00' };
    if (this._isMacOS) {
      return await this._execCommand('drutil', 'tray', 'eject');
    }
    return await this._execCommand('eject', this._devicePath);
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
