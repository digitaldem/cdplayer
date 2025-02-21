const axios = require('axios');
const crypto = require('crypto');
const { execCommand } = require('./execCommand');

const CD_DEVICE = '/dev/cdrom';
const TRACK_REGEX = /track:\s+\d+\s+lba:\s+(\d+)/g;
const LEADOUT_REGEX = /track:lout lba:\s+(\d+)/

// Retrieve TOC and Query MusicBrainz
const info = async (req, res) => {
  let discId = null;

  try {
    const output = await execCommand(`wodim dev=${CD_DEVICE} -toc`);
    let firstTrack = null;
    let lastTrack = null;
    let frameOffsets = Array(100).fill(0);

    let match;
    while ((match = TRACK_REGEX.exec(output)) !== null) {
      const trackNum = parseInt(match[1], 10);
      const lba = parseInt(match[2], 10);

      if (firstTrack === null) {
        firstTrack = trackNum;
      }
      lastTrack = trackNum;
      frameOffsets[trackNum - 1] = lba;
    }
    match = LEADOUT_REGEX.exec(output);
    if (match) {
      frameOffsets[0] = parseInt(match[1], 10);
    } else {
      throw new Error("Lead-out track not found.");
    }

    let hashInput = '';
    hashInput += firstTrack.toString(16).toUpperCase().padStart(2, '0');
    hashInput += lastTrack.toString(16).toUpperCase().padStart(2, '0');
    for (let i = 0; i < 100; i++) {
      hashInput += frameOffsets[i].toString(16).toUpperCase().padStart(8, '0');
    }

    const sha = crypto.createHash('sha1').update(hashInput).digest();
    discId = sha.toString('base64')
                .replace(/\+/g, '.')
                .replace(/\//g, '_')
                .replace(/=+$/, '');

    const response = await axios.get(`https://musicbrainz.org/ws/2/discid/${discId}?fmt=json`);
    const metadata = response.data;
    const info = { discId, metadata };
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
