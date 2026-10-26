'use strict';

const { Cache, getJson, UpstreamError } = require('./http');

function parseId(type, id) {
  if (!['movie', 'series'].includes(type) || typeof id !== 'string' || id.length > 100) return null;
  const movie = /^(tmdb:[1-9]\d{0,11}|tt\d{5,12})$/;
  const series = /^(tmdb:[1-9]\d{0,11}|tt\d{5,12}):(\d{1,4}):([1-9]\d{0,4})$/;
  const match = id.match(type === 'movie' ? movie : series);
  if (!match) return null;
  return {
    type, baseId: match[1],
    tmdbId: match[1].startsWith('tmdb:') ? match[1].slice(5) : null,
    season: type === 'series' ? Number(match[2]) : undefined,
    episode: type === 'series' ? Number(match[3]) : undefined
  };
}

function createIdResolver(config, fetchImpl = fetch) {
  const cache = new Cache();
  return async function resolveId(type, id) {
    const parsed = parseId(type, id);
    if (!parsed) return null;
    if (parsed.tmdbId) return parsed;
    const tmdbId = await cache.get(`${type}:${parsed.baseId}`, async () => {
      const data = await getJson(`${config.cinemetaBaseUrl}/meta/${type}/${parsed.baseId}.json`, { fetchImpl, timeoutMs: config.apiTimeoutMs });
      const mapped = String(data?.meta?.moviedb_id || '');
      if (!/^[1-9]\d{0,11}$/.test(mapped)) throw new UpstreamError('ID_MAPPING', `Cinemeta has no TMDB mapping for ${parsed.baseId}. Use a tmdb: ID instead.`);
      return { value: mapped, ttlSeconds: 12 * 60 * 60 };
    });
    return { ...parsed, tmdbId };
  };
}

module.exports = { parseId, createIdResolver };
