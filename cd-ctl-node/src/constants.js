const HOST = '0.0.0.0';
const PORT = 8080;

const CD_DEVICE = '/dev/cdrom';
const AUDIO_DEVICE = 'pipewire/alsa_output.usb-BurrBrown_from_Texas_Instruments_USB_AUDIO_DAC-00.analog-stereo';
const SECTOR_OFFSET = 150;
const MB_URL = 'https://musicbrainz.org/ws/2/discid';
const MB_HEADERS = { 'User-Agent': 'CDPlayer/1.0.0 (dave@digitaldementia.com)' };

module.exports = {
  HOST,
  PORT,
  CD_DEVICE,
  AUDIO_DEVICE,
  SECTOR_OFFSET,
  MB_URL,
  MB_HEADERS,
};
