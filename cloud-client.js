(function (root) {
  'use strict';
  const shared = typeof module !== 'undefined' && module.exports ? require('./ollama-client.js') : root.OllamaLocal;

  function normalizeUrl(value) {
    if (!String(value || '').trim()) throw new Error('Cloud generation is not set up. Ask the workspace owner to configure it.');
    let url;
    try { url = new URL(String(value).trim()); }
    catch { throw new Error('The cloud proxy URL is invalid. Ask the workspace owner to check its configuration.'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase());
    if (!(url.protocol === 'https:' || (url.protocol === 'http:' && local)) ||
        url.username || url.password || url.search || url.hash) {
      throw new Error('The cloud proxy URL must use HTTPS, without credentials, query or fragment. HTTP is allowed only on localhost.');
    }
    return url.href;
  }

  async function generateSuite(endpoint, input, fetchImpl = root.fetch, timeoutMs = 150000) {
    const url = normalizeUrl(endpoint);
    let safeInput;
    try { safeInput = shared.requestInput(input); }
    catch (error) { throw new Error(error.message.replaceAll('Ollama', 'the cloud service')); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safeInput), signal: controller.signal,
        mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'
      });
      if (response.status === 429) throw new Error('Cloud generation is busy or rate-limited. Wait and try again.');
      if (!response.ok) throw new Error(`Cloud generation failed (HTTP ${response.status}). Ask the workspace owner to check the service.`);
      let payload;
      try { payload = await response.json(); }
      catch { throw new Error('Cloud generation returned invalid JSON. Your existing cases were not changed.'); }
      try { return shared.validateSuite(payload, safeInput.requirement); }
      catch (error) { throw new Error(error.message.replaceAll('Ollama', 'Cloud generation')); }
    } catch (error) {
      if (controller.signal.aborted || error.name === 'AbortError') throw new Error('Cloud generation timed out. Your existing cases were not changed.');
      if (error instanceof TypeError) throw new Error('Could not reach the cloud service. Check the connection or ask the workspace owner to check CORS.');
      throw error;
    } finally { clearTimeout(timer); }
  }

  const api = { normalizeUrl, generateSuite };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CloudGeneration = api;
})(globalThis);
