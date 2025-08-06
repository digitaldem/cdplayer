class Metadata {
  constructor(discId) {
    if (discId == undefined || discId == null) {
      throw new Error('Metadata requires a discId');
    }
    this.discId = discId;
    this.artist = null;
    this.year = null;
    this.album = null;
    this.albumArt = null;
    this.tracks = [];
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

module.exports = Metadata;
