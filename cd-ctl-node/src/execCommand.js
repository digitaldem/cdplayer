const { exec } = require('child_process');

/**
 * Executes a shell command and returns the result via a Promise.
 * @param {string} command - The command to execute.
 * @returns {Promise<string>} - Resolves with stdout or rejects with an error.
 */
const execCommand = (command) => {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error: ${error.message}`);
        return reject(error);
      }
      if (stderr) {
        console.error(`Stderr: ${stderr}`);
        return reject(new Error(stderr));
      }
      resolve(stdout.trim());
    });
  });
};

module.exports = { execCommand };
