'use strict';

const { createToken } = require('./token');
const { getJson, UpstreamError, Cache } = require('./http');
const { mediaUrl } = require('./media');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const inspectMedia = promisify(execFile);

async function readDuration(data) {
  const source = Object.values(data.stream.qualities || {}).find(value => value?.type === 'mp4' && mediaUrl(value.url));
  if (!source) return null;
  try {
    const { stdout } = await inspectMedia('ffprobe', [
      '-v', 'error', '-rw_timeout', '5000000', '-probesize', '65536',
      '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', source.url
    ], { timeout: 6500, maxBuffer: 8192, windowsHide: true });
    const seconds = Number(stdout.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch { return null; } // Bitrate is optional; missing ffprobe must never hide playable streams.
}

function buildApiUrl(target, config, timestamp) {
  const token = createToken(target.tmdbId, timestamp, config.keyHex);
  const path = target.type === 'series'
    ? `/api/b/tv/${token}/${target.season}/${target.episode}`
    : `/api/b/movie/${token}`;
  return `${config.vidlinkBaseUrl}${path}?multiLang=${config.multiLang}`;
}

function createVidlinkResolver(config, fetchImpl = fetch, durationProbe = readDuration) {
  const cache = new Cache();
  return target => cache.get(`${target.type}:${target.tmdbId}:${target.season}:${target.episode}`, async () => {
    const page = target.type === 'series' ? `/tv/${target.tmdbId}/${target.season}/${target.episode}` : `/movie/${target.tmdbId}`;
    const data = await getJson(buildApiUrl(target, config), {
      fetchImpl, timeoutMs: config.apiTimeoutMs,
      headers: {
        Accept: 'application/json', 'User-Agent': config.userAgent,
        Origin: config.vidlinkBaseUrl, Referer: `${config.vidlinkBaseUrl}${page}`,
        'X-Playback-Environment': config.playbackEnvironment
      }
    });
    if (!data || typeof data !== 'object' || !data.stream || typeof data.stream !== 'object') {
      throw new UpstreamError('VIDLINK_NO_SOURCE', 'VidLink returned no source for this title or episode (JSON null or missing stream).');
    }
    const providerTtl = Number(data.stream.TTL ?? data.TTL ?? 3600);
    const ttlSeconds = Math.max(0, Math.min(config.cacheSeconds, Number.isFinite(providerTtl) ? providerTtl - 30 : 0));
    const durationSeconds = await durationProbe(data);
    return { value: { data, ttlSeconds, durationSeconds }, ttlSeconds };
  });
}

module.exports = { buildApiUrl, createVidlinkResolver };
