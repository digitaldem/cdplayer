const axios = require('axios');
const crypto = require('crypto');
const { execCommand } = require('./execCommand');

const CD_DEVICE = '/dev/cdrom';
const SECTOR_OFFSET = 150;
const MB_URL = 'https://musicbrainz.org/ws/2/discid';
const MB_HEADERS = { 'User-Agent': 'CDPlayer/1.0.0 (dave@digitaldementia.com)' };

// Retrieve TOC and Query MusicBrainz
const info = async (req, res) => {
  let toc = [];
  let offsets = [];
  let discId = null;

  try {
    const output = await execCommand(`wodim dev=${CD_DEVICE} -toc`);

    for (const line of output.split('\n')) {
      if (line.startsWith('first:')) {
        toc.push(...line.match(/first:\s+(\d+)\s+last\s+(\d+)/).slice(1).map(Number));
        continue;
      }

      if (line.startsWith('track:')) {
        const [, trackNum, offset] = line.match(/track:\s+(\d+|lout)\s+lba:\s+(\d+)/) || [];

        if (trackNum.includes('lout')) {
          toc.push(parseInt(offset) + SECTOR_OFFSET);
        } else {
          offsets.push(parseInt(offset) + SECTOR_OFFSET);
        }
      }
    }
    toc.push(...offsets);
    discId = crypto.createHash('sha1')
                   .update(toc.join(' '))
                   .digest('base64')
                   .replace(/\+/g, '.')
                   .replace(/\//g, '_')
                   .replace(/=/g, '');

    const response = await axios.get(`${MB_URL}/${discId}?fmt=json`, MB_HEADERS);
    const metadata = response.data;
    const info = { discId, metadata };
    res.json({ success: true, error: null, info });
  } catch (e) {
    res.status(500).json({ success: false, error: `TOC: ${toc.join(' ')}\nDisc ID: ${discId ?? 'null'}\n${e.message}` });
  }
};

// Play the CD
const play = async (req, res) => {
  try {
    const output = await execCommand(`mplayer cdda://${CD_DEVICE}`);
    res.json({ success: true, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// Pause playback
const pause = async (req, res) => {
  try {
    const output = await execCommand('mplayer pause');
    res.json({ success: true, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// Stop playback
const stop = async (req, res) => {
  try {
    const output = await execCommand('pkill mplayer');
    res.json({ success: true, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// Skip to next track
const next = async (req, res) => {
  try {
    const output = await execCommand('mplayer -cd 0 -chapter +1');
    res.json({ success: true, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// Go to previous track
const previous = async (req, res) => {
  try {
    const output = await execCommand('mplayer -cd 0 -chapter -1');
    res.json({ success: true, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

// Eject the CD
const eject = async (req, res) => {
  try {
    const output = await execCommand(`eject ${CD_DEVICE}`);
    res.json({ success: true, error: null });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
};

module.exports = {
  info,
  play,
  pause,
  stop,
  next,
  previous,
  eject,
};
