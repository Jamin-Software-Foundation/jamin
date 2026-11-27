(() => {
  const status = document.createElement('p');
  status.className = 'status';
  status.setAttribute('role', 'status');
  document.getElementById('global-status').appendChild(status);

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    status.textContent = 'Offline unavailable: use HTTPS or localhost in a supported browser.';
    return;
  }

  let failed = false;
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.source !== 'jamin-offline') return;
    if (event.data.type === 'progress') {
      status.textContent = `Preparing offline: ${event.data.done}/${event.data.total} files. Keep this page open.`;
    } else if (event.data.type === 'error') {
      failed = true;
      status.textContent = `Offline preparation failed: ${event.data.message}. Check connection and storage, then reload to retry.`;
    }
  });

  navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' }).then(registration => {
    const showState = worker => {
      if (worker.state === 'installed') {
        status.textContent = registration.active
          ? 'Offline update ready. Close all Jamin tabs and reopen to use it.'
          : 'Offline download complete; activating...';
      } else if (worker.state === 'activated') {
        status.textContent = 'Offline ready.';
      } else if (worker.state === 'redundant' && !failed) {
        status.textContent = 'Offline preparation failed. Check connection and storage, then reload to retry.';
      }
    };
    const watch = worker => {
      if (!worker) return;
      worker.addEventListener('statechange', () => showState(worker));
      showState(worker);
    };
    if (registration.waiting) watch(registration.waiting);
    else if (registration.installing) watch(registration.installing);
    else if (registration.active) status.textContent = 'Offline ready.';
    else status.textContent = 'Preparing offline download...';
    registration.addEventListener('updatefound', () => watch(registration.installing));
  }).catch(error => {
    status.textContent = `Offline registration failed: ${error.message}`;
  });
})();
