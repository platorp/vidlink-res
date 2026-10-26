'use strict';

function mediaUrl(value) {
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) return null;
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || /\.(localhost|local|internal)$/.test(host) || /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '::1' || host === '::' || /^(fc|fd|fe80):/i.test(host)) return null;
    return url;
  } catch { return null; }
}

function cleanHeaders(headers) {
  const clean = {};
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return clean;
  for (const [name, value] of Object.entries(headers)) {
    if (/^[!#$%&'*+.^_`|~\w-]+$/.test(name) && typeof value === 'string' && !/[\r\n\0]/.test(value) && !/^(host|connection|content-length|transfer-encoding)$/i.test(name)) clean[name] = value;
  }
  return clean;
}

module.exports = { mediaUrl, cleanHeaders };
