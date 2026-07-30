const fs = require('fs');

function loadEnv() {
  if (!fs.existsSync('.env')) return;
  fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const eq = trimmed.indexOf('=');
    if (eq === -1) return;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (k) process.env[k] = v;
  });
}

async function waitForDelay(milliseconds, message = '') {
  if (message) {
    console.log(message);
  }
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

module.exports = {
  loadEnv,
  waitForDelay
};
