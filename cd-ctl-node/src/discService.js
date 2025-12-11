const axios = require('axios');
const fs = require('fs').promises;
const https = require('https');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const DiscInfo = require('./discInfo');
const eventBus = require('./eventBus');
const { MB_URL, MB_HEADERS } = require('./constants');

const run = promisify(exec);

class DiscService {
  constructor(dir) {
    // Singleton
    if (DiscService.instance) {
      return DiscService.instance;
    }

    eventBus.on('insert', (toc) => this.setInfo(toc));
    eventBus.on('eject', () => this.setInfo(''));

    fs.mkdir(dir, { recursive: true }).catch(() => {});
    this.dir = dir;
    this._info = new DiscInfo('');
    DiscService.instance = this;
  }

  static getInstance() {
    if (!DiscService.instance) {
      new DiscService(path.join(__dirname, '..', 'cache'));
    }
    return DiscService.instance;
  }

  _buildFileName(key) {
    return path.join(this.dir, `${key}.json`);
  }

  async getInfo() {
    return this._info;
  }

  async setInfo(toc) {
    this._info = new DiscInfo(toc);
    const discId = this._info.discId;
    const trackCount = this._info.tracks.length;
    if (discId === '') {
      eventBus.emit('info', this._info);
      return;
    }

    const filename = this._buildFileName(discId);
    try {
      await fs.access(filename);
      const adapter = new JSONFile(filename);
      const db = new Low(adapter, {});
      await db.read();
      this._info.fromObject(db.data || {});
      eventBus.emit('info', this._info);
      return;
    } catch (err) {
      // Log but continue to fetch data from the API
      //console.error('Error reading metadata from cache:', err);
    }

    let mbdata = null;
    try {
      // Call MusicBrainz API for lookup by DiscId
      const response = await axios.get(`${MB_URL}/${discId}?fmt=json&inc=artist-credits+recordings`, {
        headers: MB_HEADERS,
        timeout: 10000,
        httpsAgent: new https.Agent({ family: 4 })
      });
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
          this._info.setArtist(release['artist-credit'].map(ac => ac['name']).join(', ') || null);
        }
        if (release['date'] && release['date'].length > 0) {
          this._info.setYear(release['date'].split(/[-/]/)[0] || null);
        }
        if (release['title'] && release['title'].length > 0) {
          this._info.setAlbum(release['title'] || null);
        }
        if (release['cover-art-archive'] && release['cover-art-archive']['front']) {
          this._info.setAlbumArt(`https://coverartarchive.org/release/${release['id']}/front`);
        }
        if (release['media'] && release['media'].length > 0) {
          //TODO: Handle multi disc sets
          const media = release['media'][0];

          // Extract track data
          if (media['tracks'] && media['tracks'].length === trackCount) {
            // Sort tracks by position and extract titles
            media['tracks'].sort((a, b) => a['position'] - b['position']);
            this._info.setTracks(media['tracks'].map(track => track['title']));
          }
        }
      }

      try {
        const adapter = new JSONFile(filename);
        const db = new Low(adapter, {});
        db.data = this._info.toObject();
        await db.write();
        await fs.access(filename);
        await run(`git add ${filename}`);
        await run(`git commit -m "Add ${discId} to metadata cache"`);
        await run(`git pull --rebase origin HEAD`);
        await run(`git push origin HEAD`);
      } catch (err) {
        // Log but continue
        console.error('Error writing and pushing metadata to git cache:', err);
      }
    }
    eventBus.emit('info', this._info);
  }

  async refresh() {
    try {
      await run(`git pull origin`);

      const filename = this._buildFileName(this._info.discId);
      await fs.access(filename);
      const adapter = new JSONFile(filename);
      const db = new Low(adapter, {});
      await db.read();
      this._info.fromObject(db.data || {});
      eventBus.emit('info', this._info);
      return true;
    } catch (err) {
      // Log but continue
      console.error(`Git pull of metadata failed: ${err.message}`);
    }
    return false;
  }
}

module.exports = DiscService.getInstance();
