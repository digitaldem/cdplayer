const axios = require('axios');
const { execCommand } = require('../src/execCommand');
const handlers = require('../src/handlers');

jest.mock('axios');
jest.mock('../src/execCommand');

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('CD Info Handler', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should return CD info successfully', async () => {
    const mockExecOutput = "760b5c0b 12 234567 150 16034 32890 48500";
    execCommand.mockResolvedValue(mockExecOutput);

    axios.get.mockResolvedValue({
      data: { title: 'Dark Side of the Moon', artist: 'Pink Floyd' },
    });

    const req = {};
    const res = mockResponse();

    await handlers.info(req, res);

    expect(execCommand).toHaveBeenCalledWith('cd-discid /dev/cdrom');
    expect(axios.get).toHaveBeenCalledWith(
      'https://musicbrainz.org/ws/2/discid/760b5c0b?fmt=json'
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      error: null,
      info: {
        discId: '760b5c0b',
        trackCount: 12,
        leadout: 234567,
        trackOffsets: [150, 16034, 32890, 48500],
        metadata: { title: 'Dark Side of the Moon', artist: 'Pink Floyd' },
      },
    });
  });

  test('should handle MusicBrainz API failure', async () => {
    const mockExecOutput = "760b5c0b 12 234567 150 16034 32890 48500";
    execCommand.mockResolvedValue(mockExecOutput);

    axios.get.mockRejectedValue(new Error('MusicBrainz service unavailable'));

    const req = {};
    const res = mockResponse();

    await handlers.info(req, res);

    expect(execCommand).toHaveBeenCalledWith('cd-discid /dev/cdrom');
    expect(axios.get).toHaveBeenCalledWith(
      'https://musicbrainz.org/ws/2/discid/760b5c0b?fmt=json'
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Disc ID: 760b5c0b\nMusicBrainz service unavailable',
    });
  });

  test('should handle invalid CD TOC output', async () => {
    execCommand.mockResolvedValue('760b5c0b');

    const req = {};
    const res = mockResponse();

    await handlers.info(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Disc ID: null\nInvalid CD information retrieved',
    });
  });

  test('should handle execCommand failure', async () => {
    execCommand.mockRejectedValue(new Error('Command failed'));

    const req = {};
    const res = mockResponse();

    await handlers.info(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Disc ID: null\nCommand failed',
    });
  });
});

describe('CD Control Handlers', () => {
  const commands = {
    play: `mplayer cdda:///dev/cdrom`,
    pause: 'mplayer pause',
    stop: 'pkill mplayer',
    next: 'mplayer -cd 0 -chapter +1',
    previous: 'mplayer -cd 0 -chapter -1',
    eject: 'eject /dev/cdrom',
  };

  Object.keys(commands).forEach((action) => {
    test(`should execute ${action} command successfully`, async () => {
      execCommand.mockResolvedValue('');

      const req = {};
      const res = mockResponse();

      await handlers[action](req, res);

      expect(execCommand).toHaveBeenCalledWith(commands[action]);
      expect(res.json).toHaveBeenCalledWith({ success: true, error: null });
    });

    test(`should handle ${action} command failure`, async () => {
      execCommand.mockRejectedValue(new Error(`${action} failed`));

      const req = {};
      const res = mockResponse();

      await handlers[action](req, res);

      expect(execCommand).toHaveBeenCalledWith(commands[action]);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: `${action} failed` });
    });
  });
});
