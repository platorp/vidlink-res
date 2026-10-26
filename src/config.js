'use strict';

const { randomBytes } = require('node:crypto');

function integer(value, fallback, min, max, name) {
  const number = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return number;
}

function origin(value, name) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) origin without a path, query, or credentials.`);
  }
  return url.origin;
}

function loadConfig(env = process.env) {
  const port = integer(env.PORT, 7001, 1, 65535, 'PORT');
  const proxyMode = env.PROXY_MODE || 'auto';
  if (!['auto', 'always', 'never'].includes(proxyMode)) throw new Error('PROXY_MODE must be auto, always, or never.');
  const playbackEnvironment = env.PLAYBACK_ENVIRONMENT || 'standard';
  if (!['standard', 'hls', 'webkit', 'dash-hevc'].includes(playbackEnvironment)) throw new Error('Invalid PLAYBACK_ENVIRONMENT.');
  if (env.PROXY_SECRET && env.PROXY_SECRET.length < 32) throw new Error('PROXY_SECRET must contain at least 32 characters.');
  return {
    host: env.HOST || (env.RENDER === 'true' ? '0.0.0.0' : '127.0.0.1'), port,
    publicUrl: origin(env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${port}`, 'PUBLIC_URL'),
    vidlinkBaseUrl: origin(env.VIDLINK_BASE_URL || 'https://vidlink.pro', 'VIDLINK_BASE_URL'),
    mediaProxyUrl: env.MEDIA_PROXY_URL ? origin(env.MEDIA_PROXY_URL, 'MEDIA_PROXY_URL') : null,
    proxySecret: env.PROXY_SECRET || randomBytes(32).toString('hex'),
    proxyTtlSeconds: integer(env.PROXY_TTL_SECONDS, 21600, 300, 86400, 'PROXY_TTL_SECONDS'),
    cinemetaBaseUrl: 'https://v3-cinemeta.strem.io',
    multiLang: integer(env.MULTI_LANG, 0, 0, 1, 'MULTI_LANG'),
    apiTimeoutMs: integer(env.API_TIMEOUT_MS, 25000, 1000, 120000, 'API_TIMEOUT_MS'),
    cacheSeconds: integer(env.CACHE_SECONDS, 300, 0, 1800, 'CACHE_SECONDS'),
    proxyMode, playbackEnvironment,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    keyHex: env.VIDLINK_KEY_HEX || undefined
  };
}

module.exports = { loadConfig };
