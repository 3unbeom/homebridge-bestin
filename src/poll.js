'use strict';

const POLL_INTERVAL_MS = 60000;

function startPolling(fn) {
  fn();
  const jitter = Math.random() * POLL_INTERVAL_MS;
  setTimeout(() => {
    setInterval(fn, POLL_INTERVAL_MS);
  }, jitter);
}

module.exports = { startPolling, POLL_INTERVAL_MS };
