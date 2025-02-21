const axios = require('axios');
const baseX = require('base-x');
const crypto = require('crypto');
const { execCommand } = require('./execCommand');

const CD_DEVICE = '/dev/cdrom';
const TRACK_REGEX = /track:\s+\d+\s+lba:\s+(\d+)/g;
const LEADOUT_REGEX = /track:lout lba:\s+(\d+)/
const base28 = baseX('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ');

// Retrieve TOC and Query MusicBrainz
const info = async (req, res) => {
  let discId = null;

  try {
    const output = await execCommand(`wodim dev=${CD_DEVICE} -toc`);
    let trackCount = 0;
    let toc = '';
    let match;
    while ((match = TRACK_REGEX.exec(output)) !== null) {
        trackCount++;
        toc += match[1].padStart(8, '0');
    }
    if ((match = LEADOUT_REGEX.exec(output))) {
        toc += match[1].padStart(8, '0');
    }
    const md5 = crypto.createHash('md5').update(`${trackCount}${toc}`).digest('hex');
    discId = base28.encode(Buffer.from(md5, 'hex'));

    const response = await axios.get(`https://musicbrainz.org/ws/2/discid/${discId}?fmt=json`);
    const metadata = response.data;
    const info = { discId, trackCount, metadata };
    res.json({ success: true, error: null, info });
  } catch (e) {
    res.status(500).json({ success: false, error: `Disc ID: ${discId ?? 'null'}\n${e.message}` });
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
