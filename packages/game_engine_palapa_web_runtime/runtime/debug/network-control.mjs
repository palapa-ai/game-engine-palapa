import { networkProfile, networkProfiles } from './network.mjs';

export async function createNetworkControl(workerUrl) {
  const element = document.createElement('div');
  element.style.cssText = 'position:fixed;top:12px;right:12px;z-index:100;background:#151515;color:white;padding:10px;font:12px ui-monospace,monospace';
  const select = document.createElement('select');
  select.style.cssText = 'font:inherit;color:white;background:#282828;padding:6px;border:1px solid #555;max-width:100%';
  select.setAttribute('aria-label', 'Simulated network');
  select.title = 'Reloads with simulated download speed, latency and interruptions. Broadband removes the simulation.';
  for (const [key, profile] of Object.entries(networkProfiles)) {
    const option = document.createElement('option');
    option.value = key; option.textContent = profile.label; select.append(option);
  }
  select.value = networkProfile(location.href);
  element.append(select); document.body.append(element);
  select.disabled = true;
  select.addEventListener('change', () => {
    const url = new URL(location.href);
    if (select.value === 'fast') url.searchParams.delete('network');
    else url.searchParams.set('network', select.value);
    location.assign(url.href);
  });
  try {
    if (!navigator.serviceWorker) throw Error('Network simulation unavailable in this browser');
    await navigator.serviceWorker.register(workerUrl, { type: 'module', scope: '/debug', updateViaCache: 'none' });
    await new Promise((resolve, reject) => {
      const expected = new URL(workerUrl, location.href).href;
      const ready = () => {
        if (navigator.serviceWorker.controller?.scriptURL !== expected) return;
        clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', ready);
        resolve();
      };
      const timeout = setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', ready);
        reject(Error('Network simulation could not start'));
      }, 8000);
      navigator.serviceWorker.addEventListener('controllerchange', ready);
      ready();
    });
    navigator.serviceWorker.controller.postMessage('clear-network-budget');
    select.disabled = false;
  } catch (error) {
    const status = document.createElement('span'); status.textContent = ' Network simulation unavailable';
    status.title = error.message; element.append(status);
  }
  return element;
}
