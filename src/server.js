'use strict';

const express = require('express');
const { getRouter } = require('stremio-addon-sdk');
const { loadConfig } = require('./config');
const { createAddon, manifest } = require('./addon');
const { createProxyHandler } = require('./proxy');

function createApp(config, dependencies) {
  const app = express();
  app.disable('x-powered-by');
  const logger = dependencies?.logger || console;
  app.use((req, res, next) => {
    // Older clients use a Private Network Access preflight. Modern browsers may
    // additionally require the user's local-network permission or a public URL.
    if (req.headers['access-control-request-private-network'] === 'true') res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.path === '/manifest.json' || req.path.startsWith('/stream/')) {
      const started = Date.now();
      res.on('finish', () => logger.info?.(`[VidLink HTTP] ${req.method} ${req.path} -> ${res.statusCode} (${Date.now() - started} ms)`));
    }
    next();
  });
  app.all('/proxy/:ticket/:filename', createProxyHandler(config, { fetchImpl: dependencies?.mediaFetchImpl, logger: dependencies?.logger }));
  app.get('/health', (_req, res) => res.json({ ok: true, name: manifest.name, version: manifest.version }));
  app.get('/', (_req, res) => {
    const manifestUrl = `${config.publicUrl}/manifest.json`;
    const webInstallUrl = `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`;
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>VidLink Add-on</title><style>body{max-width:650px;margin:12vh auto;padding:24px;background:#151324;color:#eee;font:18px/1.6 system-ui}a{color:#b7a0ff}code{overflow-wrap:anywhere}h1{line-height:1.2}</style><h1>VidLink · All Qualities</h1><p>Fresh movie and TV streams in every available quality.</p><p><a href="${webInstallUrl}">Install in Stremio Web</a></p><p><a href="${config.publicUrl.replace(/^https?:/, 'stremio:')}/manifest.json">Open installation in the Stremio desktop app</a></p><p>You can also open Add-ons in Stremio and paste this manifest URL:</p><p><code>${manifestUrl}</code></p></html>`);
  });
  app.use(getRouter(createAddon(config, dependencies)));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

function start(config = loadConfig()) {
  const server = createApp(config).listen(config.port, config.host, () => {
    console.log(`VidLink add-on: ${config.publicUrl}/manifest.json`);
    console.log(`Episode test: ${config.publicUrl}/stream/series/tmdb:72351:1:25.json`);
    console.log(`Playback environment: ${config.playbackEnvironment}; media proxy: ${config.proxyMode}`);
  });
  server.on('error', error => { console.error(`Cannot start add-on: ${error.message}`); process.exitCode = 1; });
  const shutdown = () => server.close(() => process.exit(0));
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}

if (require.main === module) { try { start(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { createApp, start };
