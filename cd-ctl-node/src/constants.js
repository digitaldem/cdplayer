const HOST = '0.0.0.0';
const PORT = 80;

const CD_DEVICE = '/dev/cdrom';
const SECTOR_OFFSET = 150;
const MB_URL = 'https://musicbrainz.org/ws/2/discid';
const MB_HEADERS = { 'User-Agent': 'CDPlayer/1.0.0 (dave@digitaldementia.com)' };

module.exports = {
  HOST,
  PORT,
  CD_DEVICE,
  SECTOR_OFFSET,
  MB_URL,
  MB_HEADERS,
};
