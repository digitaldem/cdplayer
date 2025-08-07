const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const { MB_URL, MB_HEADERS } = require('./constants');
const Metadata = require('./metadata');

class MetadataService {
  constructor(dir) {
    // Singleton
    if (MetadataService.instance) {
      return MetadataService.instance;
    }

    this.dir = dir;
    fs.mkdir(this.dir, { recursive: true }).catch(() => {});
    MetadataService.instance = this;
  }

  static getInstance() {
    if (!MetadataService.instance) {
      new MetadataService(path.join(__dirname, '..', 'cache'));
    }
    return MetadataService.instance;
  }

  _buildFileName(key) {
    return path.join(this.dir, `${key}.json`);
  }

  async get(discId) {
    const metadata = new Metadata(discId);

    const filename = this._buildFileName(discId);
    try {
      await fs.access(filename);
      const adapter = new JSONFile(filename);
      const db = new Low(adapter, {});
      await db.read();
      metadata.fromObject(db.data || {});
      return metadata;
    } catch (err) {
      // Log but continue to fetch data from the API
      //console.error('Error reading metadata from cache:', err);
    }

    let mbdata = null;
    try {
      // Call MusicBrainz API for lookup by DiscId
      const response = await axios.get(`${MB_URL}/${discId}?fmt=json&inc=artist-credits+recordings`, { headers: MB_HEADERS });
      mbdata = response.data;
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.status === 404) {
          //console.warn(`Disc ID ${discId} not found in MusicBrainz.`);
          mbdata = { releases: [] };
        } else {
          console.error('Error fetching metadata from API:', err);
          mbdata = null;
        }
      } else {
        console.error('Error fetching metadata from API:', err);
        mbdata = null;
      }
    }

    if (mbdata) {
      // Parse MB response
      if (mbdata['releases'] && mbdata['releases'].length > 0) {
        // Grab the first "release" (usually has the best accuracy)
        const release = mbdata['releases'][0];

        // Extract basic data
        if (release['artist-credit'] && release['artist-credit'].length > 0) {
          metadata.setArtist(release['artist-credit'].map(ac => ac['name']).join(', ') || null);
        }
        if (release['date'] && release['date'].length > 0) {
          metadata.setYear(release['date'].split(/[-/]/)[0] || null);
        }
        if (release['title'] && release['title'].length > 0) {
          metadata.setAlbum(release['title'] || null);
        }
        if (release['cover-art-archive'] && release['cover-art-archive']['front']) {
          metadata.setAlbumArt(`https://coverartarchive.org/release/${release['id']}/front`);
        }
        if (release['media'] && release['media'].length > 0) {
          //TODO: Handle multi disc sets
          const media = release['media'][0];

          // Extract track data
          if (media['tracks'] && media['tracks'].length > 0) {
            // Sort tracks by position and extract titles
            media['tracks'].sort((a, b) => a['position'] - b['position']);
            metadata.setTracks(media['tracks'].map(track => track.title));
          }
        }
      }
      await this.set(discId, metadata);
    }

    return metadata;
  }

  async set(discId, data) {
    const filename = this._buildFileName(discId);
    try {
      const adapter = new JSONFile(filename);
      const db = new Low(adapter, {});
      db.data = data.toObject();
      await db.write();
      await fs.access(filename);
      return true;
    } catch (err) {
      // Log but continue
      console.error('Error writing metadata to cache:', err);
    }
    return false;
  }

  async remove(discId) {
    const filename = this._buildFileName(discId);
    try {
      await fs.unlink(filename);
      return true;
    } catch (err) {
      // Log but continue
      console.error('Error deleting metadata from cache:', err);
    }
    return false;
  }
}

module.exports = MetadataService.getInstance();
