const crypto = require('crypto');
const { SECTOR_OFFSET } = require('./constants');

class DiscInfo {
  constructor(toc) {
    if (toc == undefined) {
      throw new Error('DiscInfo requires a TOC');
    }
    const [discId, trackCount] = this._parseTOC(toc);
    this.discId = discId;
    this.tracks = Array.from({ length: trackCount }, (_, i) => null);

    this.artist = (discId === '') ? 'No Disc' : null;
    this.year = null;
    this.album = null;
    this.albumArt = null;
  }

  _parseTOC(tocString) {
    if (tocString === '') {
      return ['', 0];
    }

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
      return ['', 0];
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

  setArtist(value) {
    this.artist = value;
  }
  setYear(value) {
    this.year = value;
  }
  setAlbum(value) {
    this.album = value;
  }
  setAlbumArt(value) {
    this.albumArt = value;
  }
  setTracks(value) {
    this.tracks = value;
  }

  // Helper methods to convert to/from plain object
  fromObject(data) {
    if (data.artist !== undefined) {
      this.artist = data.artist;
    }
    if (data.year !== undefined) {
      this.year = data.year;
    }
    if (data.album !== undefined) {
      this.album = data.album;
    }
    if (data.albumArt !== undefined) {
      this.albumArt = data.albumArt;
    }
    if (data.tracks !== undefined) {
      this.tracks = data.tracks;
    }
  }

  toObject() {
    return {
      discId: this.discId,
      artist: this.artist,
      year: this.year,
      album: this.album,
      albumArt: this.albumArt,
      tracks: this.tracks
    };
  }
}

module.exports = DiscInfo;
