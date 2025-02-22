const axios = require('axios');
const crypto = require('crypto');
const { execCommand } = require('./execCommand');

const CD_DEVICE = '/dev/cdrom';
const SECTOR_OFFSET = 150;
const MB_URL = 'https://musicbrainz.org/ws/2/discid';
const MB_HEADERS = { 'User-Agent': 'CDPlayer/1.0.0 (dave@digitaldementia.com)' };

// Retrieve TOC and Query MusicBrainz
const info = async (req, res) => {
  let toc = new Array(102).fill('0'.repeat(8));
  let discId = null;
  const metadata = {
    artist: null,
    year: null,
    album: null,
    albumArt: null,
    tracks: []
  };

  try {
    const output = await execCommand(`wodim dev=${CD_DEVICE} -toc`);

    for (const line of output.split('\n')) {
      if (line.startsWith('first:')) {
        toc.splice(0, 2, ...line.match(/first:\s+(\d+)\s+last\s+(\d+)/).slice(1).map(x => parseInt(x).toString(16).padStart(2, '0').toUpperCase()));
        continue;
      }

      if (line.startsWith('track:')) {
        const [, trackNum, offset] = line.match(/track:\s*(\d+|lout)\s+lba:\s+(\d+)/) || [];
        const offsetHex = (parseInt(offset) + SECTOR_OFFSET).toString(16).padStart(8, '0').toUpperCase();
        if (trackNum === 'lout') {
          toc[2] = offsetHex;
        } else {
          toc[parseInt(trackNum) + 2] = offsetHex;
        }
      }
    }
    discId = crypto.createHash('sha1')
                   .update(toc.join(''))
                   .digest('base64')
                   .replace(/\+/g, '.')
                   .replace(/\//g, '_')
                   .replace(/=/g, '-');

    const response = await axios.get(`${MB_URL}/${discId}?fmt=json&inc=artist-credits+recordings`, MB_HEADERS);
    const mbdata = response.data;
    if (mbdata.releases && mbdata.releases.length > 0) {
      const release = mbdata.releases[0];
      metadata.artist = release['artist-credit'] ? release['artist-credit'].map(ac => ac.name).join(', ') : null;
      metadata.year = release['date'] ? release['date'].split(/[-/]/)[0] : null;
      metadata.album = release['title'] ? release['title'] : null;
      metadata.albumArt = (release['cover-art-archive']?.front) ? `https://coverartarchive.org/release/${release.id}/front` : null;
      if (release.media && release.media.length > 0) {
        const media = release.media[0];
        media['tracks']?.sort((a, b) => a.position - b.position);
        metadata.tracks = media.tracks.map(track => track.title);
      }
    }

    const info = { discId, ...metadata };
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
