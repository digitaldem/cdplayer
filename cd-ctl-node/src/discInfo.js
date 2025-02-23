const axios = require('axios');
const crypto = require('crypto');
const { CD_DEVICE } = require('./constants');
const { execCommand } = require('./execCommand');

const SECTOR_OFFSET = 150;
const MB_URL = 'https://musicbrainz.org/ws/2/discid';
const MB_HEADERS = { 'User-Agent': 'CDPlayer/1.0.0 (dave@digitaldementia.com)' };

class DiscInfo {
  constructor() {
    // Singleton
    if (!DiscInfo.instance) {
      DiscInfo.instance = this;
      this.metadata = null;
    }
    return DiscInfo.instance;
  }

  async get() {
    // Lazy-load
    if (this.metadata === null) {
      this.metadata = await this._queryDiscInfo();
    }
    return this.metadata;
  }

  async clear() {
    // Async only for API consistency
    this.metadata = null;
  }

  async _queryDiscInfo() {
    const metadata = {
      discId: null,
      artist: null,
      year: null,
      album: null,
      albumArt: null,
      tracks: [],
      error: null
    };
    
    try {
      // Get disc TOC from command line
      const output = await execCommand(`wodim dev=${CD_DEVICE} -toc`);

      // Allocate a filled string array of 102 '00000000's
      const toc = new Array(102).fill('0'.repeat(8));
    
      // Begin to parse the command line output
      for (const line of output.split('\n')) {
        // Find the "first: X last Y" line
        if (line.startsWith('first:')) {
          // Extract the two numbers and update first two TOC elements 
          // Note the string length on these elements is only 2 bytes,
          // while the remaining sector market elements use 8 bytes
          toc.splice(0, 2, ...line.match(/first:\s+(\d+)\s+last\s+(\d+)/).slice(1).map(x => parseInt(x).toString(16).padStart(2, '0').toUpperCase()));
          continue;
        }

        // Find the "track:" marker lines
        if (line.startsWith('track:')) {
          // Extract the track number (or lead out sequence)
          const [, trackNum, offset] = line.match(/track:\s*(\d+|lout)\s+lba:\s+(\d+)/) || [];
          // Apply a required standard sector offset
          const offsetHex = (parseInt(offset) + SECTOR_OFFSET).toString(16).padStart(8, '0').toUpperCase();
          if (trackNum === 'lout') {
            // Lead out sector is after both the first track number and last track number elements
            toc[2] = offsetHex;
          } else {
            // Then the actual track sector definitions start after the leadout sector element
            toc[parseInt(trackNum) + 2] = offsetHex;
          }
        }
      }
    
      // Join the TOC elements into a single string and calculate the SHA-1 hash
      metadata.discId = crypto.createHash('sha1')
                              .update(toc.join(''))
                              .digest('base64')
                              .replace(/\+/g, '.')
                              .replace(/\//g, '_')
                              .replace(/=/g, '-');

      // Call MusicBrainz API for lookup by DiscId
      const response = await axios.get(`${MB_URL}/${discId}?fmt=json&inc=artist-credits+recordings`, MB_HEADERS);
      const mbdata = response.data;
    
      // Parse MB response
      if (mbdata.releases && mbdata.releases.length > 0) {
        // Grab the first "release" (usually has the best accuracy)
        const release = mbdata.releases[0];
        // Extract basic data
        metadata.artist = release['artist-credit'] ? release['artist-credit'].map(ac => ac.name).join(', ') : null;
        metadata.year = release['date'] ? release['date'].split(/[-/]/)[0] : null;
        metadata.album = release['title'] ? release['title'] : null;
        metadata.albumArt = (release['cover-art-archive']?.front) ? `https://coverartarchive.org/release/${release.id}/front` : null;
        if (release.media && release.media.length > 0) {
          //TODO: Handle multi disc sets
          const media = release.media[0];
          media['tracks']?.sort((a, b) => a.position - b.position);
          metadata.tracks = media.tracks.map(track => track.title);
        }
      }
    } catch (e) {
      // Swallow tye exception, but do send the message back for investigation
      metadata.error = e.message;
    }
    // Return any data that was extracted 
    return metadata;
  }
}

// Export the singleton for use
const discInfo = new DiscInfo();
Object.freeze(discInfo);
module.exports = discInfo;
