'use strict';

const { addonBuilder } = require('stremio-addon-sdk');
const { createIdResolver } = require('./ids');
const { createVidlinkResolver } = require('./vidlink');
const { toStreams } = require('./streams');
const { UpstreamError } = require('./http');

const manifest = {
  id: 'community.vidlink.allqualities', version: '1.0.4', name: 'VidLink · All Qualities',
  description: 'Fresh VidLink movie and TV streams, with every available quality listed separately.',
  catalogs: [], types: ['movie', 'series'],
  resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'tmdb:'] }]
};

function createAddon(config, { fetchImpl = fetch, logger = console, resolveSource } = {}) {
  const resolveId = createIdResolver(config, fetchImpl);
  const resolveVidlink = resolveSource || createVidlinkResolver(config, fetchImpl);
  const builder = new addonBuilder(manifest);
  builder.defineStreamHandler(async ({ type, id }) => {
    try {
      const target = await resolveId(type, id);
      if (!target) { logger.info?.(`[VidLink] Unsupported ID: ${type}/${id}`); return { streams: [], cacheMaxAge: 0 }; }
      const { data, durationSeconds } = await resolveVidlink(target);
      const streams = toStreams(data, target, config, durationSeconds);
      if (!streams.length) throw new UpstreamError('VIDLINK_NO_QUALITIES', 'VidLink returned no playable quality URLs.');
      logger.info?.(`[VidLink] ${type}/${id}: ${streams.length} streams`);
      // Do not let a Stremio client cache links after the resolver's cache expires.
      return { streams, cacheMaxAge: 0, staleRevalidate: 0, staleError: 0 };
    } catch (error) {
      logger.error(`[VidLink] ${type}/${id}: ${error.code || 'RESOLVE_ERROR'}: ${error.message}`);
      return { streams: [], cacheMaxAge: 0, staleRevalidate: 0, staleError: 0,
        error: { code: error.code || 'RESOLVE_ERROR', message: error.message } };
    }
  });
  return builder.getInterface();
}

module.exports = { createAddon, manifest };
