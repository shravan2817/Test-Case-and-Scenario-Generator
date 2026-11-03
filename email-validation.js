(function (root) {
  'use strict';
  function validEmail(value) {
    if (typeof value !== 'string' || value.length > 254 || value !== value.trim()) return false;
    const parts = value.split('@');
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..') ||
        !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
    const labels = domain.split('.');
    return labels.length >= 2 && /^[a-z]{2,63}$/i.test(labels.at(-1)) &&
      labels.every(label => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
  }
  const api = { validEmail };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WorkspaceEmail = api;
})(globalThis);
