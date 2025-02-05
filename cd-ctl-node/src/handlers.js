const axios = require('axios');
const { execCommand } = require('./execCommand');

const CD_DEVICE = '/dev/cdrom';

// Retrieve TOC and Query MusicBrainz
const info = async (req, res) => {
  let discId;

  try {
    const output = await execCommand(`cd-discid ${CD_DEVICE}`);
    const toc = output.split(' ');
    if (toc.length < 3) {
      throw new Error('Invalid CD information retrieved');
    }
    discId = toc.shift();
    const response = await axios.get(`https://musicbrainz.org/ws/2/discid/${discId}?fmt=json`);
    const trackCount = parseInt(toc.shift(), 10);
    const leadout = parseInt(toc.shift(), 10);
    const trackOffsets = toc.map(Number);
    const metadata = response.data;
    const info = { discId, trackCount, leadout, trackOffsets, metadata };
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
