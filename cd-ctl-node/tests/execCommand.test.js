const { exec } = require('child_process');
const { execCommand } = require('../src/execCommand');

// Mock child_process.exec to prevent real shell execution
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

describe('execCommand', () => {
  afterEach(() => {
    jest.clearAllMocks(); // Reset mock after each test
  });

  test('should resolve with stdout when command executes successfully', async () => {
    exec.mockImplementation((cmd, callback) => callback(null, 'Success Output', ''));

    const result = await execCommand('echo "test"');
    expect(result).toBe('Success Output');
    expect(exec).toHaveBeenCalledWith('echo "test"', expect.any(Function));
  });

  test('should reject with error message when exec fails', async () => {
    const error = new Error('Command failed');
    exec.mockImplementation((cmd, callback) => callback(error, '', ''));

    await expect(execCommand('invalid-command')).rejects.toThrow('Command failed');
  });

  test('should reject with stderr as an error', async () => {
    exec.mockImplementation((cmd, callback) => callback(null, '', 'Error in command'));

    await expect(execCommand('echo "test"')).rejects.toThrow('Error in command');
  });

  test('should handle empty output gracefully', async () => {
    exec.mockImplementation((cmd, callback) => callback(null, '', ''));

    const result = await execCommand('echo "test"');
    expect(result).toBe('');
  });
});
