'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { mediaUrl, cleanHeaders } = require('./media');

function signature(payload, secret) { return createHmac('sha256', secret).update(payload).digest('base64url'); }

function createProxyUrl(url, headers, config, kind = 'mp4', expires = Math.floor(Date.now() / 1000) + config.proxyTtlSeconds) {
  const destination = mediaUrl(String(url));
  if (!destination) throw new Error('Invalid media destination.');
  const payload = Buffer.from(JSON.stringify({ url: destination.href, headers: cleanHeaders(headers), kind, expires })).toString('base64url');
  return `${config.publicUrl}/proxy/${payload}.${signature(payload, config.proxySecret)}/${kind === 'hls' ? 'playlist.m3u8' : 'video.mp4'}`;
}

function readTicket(ticket, config, now = Math.floor(Date.now() / 1000)) {
  if (typeof ticket !== 'string' || ticket.length > 16384) throw new Error('Invalid proxy ticket.');
  const [payload, mac, extra] = ticket.split('.');
  if (!payload || !mac || extra || !/^[\w-]+$/.test(payload) || !/^[\w-]+$/.test(mac)) throw new Error('Invalid proxy ticket.');
  const expected = Buffer.from(signature(payload, config.proxySecret));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Invalid proxy signature.');
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (!Number.isSafeInteger(value.expires) || value.expires <= now) { const error = new Error('Proxy link expired. Refresh the streams.'); error.status = 410; throw error; }
  if (!mediaUrl(value.url) || !['mp4', 'hls', 'auto'].includes(value.kind)) throw new Error('Invalid proxy destination.');
  return { ...value, headers: cleanHeaders(value.headers) };
}

function rewritePlaylist(text, baseUrl, ticket, config) {
  const rewrite = uri => {
    const resolved = mediaUrl(new URL(uri, baseUrl).href);
    if (!resolved) throw new Error('Invalid HLS media destination.');
    const kind = /\.m3u8$/i.test(resolved.pathname) ? 'hls' : 'auto';
    return createProxyUrl(resolved, ticket.headers, config, kind, ticket.expires);
  };
  return text.split(/\r?\n/).map(line => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${rewrite(uri)}"`);
    return rewrite(line.trim());
  }).join('\n');
}

async function limitedText(response, limit = 2 * 1024 * 1024) {
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) { await reader.cancel(); throw new Error('HLS playlist exceeds 2 MiB.'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally { reader.releaseLock(); }
}

function createProxyHandler(config, { fetchImpl = fetch, logger = console } = {}) {
  return async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Cache-Control', 'private, no-store');
    let ticket;
    try { ticket = readTicket(req.params.ticket, config); }
    catch (error) { res.status(error.status || 403).json({ error: error.message }); return; }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Range, If-Range');
      res.status(204).end(); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD, OPTIONS'); res.status(405).end(); return; }
    if (req.headers.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) { res.status(416).end(); return; }
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    let timer;
    let response;
    try {
      const headers = { ...ticket.headers, 'Accept-Encoding': 'identity' };
      // Inherit only source-supplied headers and the client's byte-range controls.
      // Browser Origin, Referer, Cookie, and User-Agent must not leak to the CDN.
      if (req.headers.range) headers.Range = req.headers.range;
      if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
      let url = ticket.url;
      for (let redirects = 0; redirects <= 5; redirects++) {
        timer = setTimeout(() => controller.abort(), config.apiTimeoutMs);
        try { response = await fetchImpl(url, { method: req.method, headers, redirect: 'manual', signal: controller.signal }); }
        finally { clearTimeout(timer); }
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        const next = location && mediaUrl(new URL(location, url).href);
        if (!next || redirects === 5) throw new Error('Invalid media redirect.');
        if (new URL(url).origin !== next.origin) {
          for (const name of Object.keys(headers)) if (/^(cookie|authorization)$/i.test(name)) delete headers[name];
        }
        url = next.href;
      }
      if (!response.ok) {
        const contentRange = response.headers.get('content-range');
        if (contentRange) res.setHeader('Content-Range', contentRange);
        await response.body?.cancel();
        res.status(response.status === 416 ? 416 : 502).json({ error: `Media source returned HTTP ${response.status}.` }); return;
      }
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const isPlaylist = ticket.kind === 'hls' || /mpegurl/i.test(contentType) || /\.m3u8(?:\?|$)/i.test(url);
      if (isPlaylist && req.method !== 'HEAD') {
        timer = setTimeout(() => controller.abort(), config.apiTimeoutMs);
        const text = await limitedText(response);
        clearTimeout(timer);
        if (!text.trimStart().startsWith('#EXTM3U')) throw new Error('Media source returned an invalid HLS playlist.');
        res.type('application/vnd.apple.mpegurl').send(rewritePlaylist(text, url, ticket, config)); return;
      }
      res.status(response.status);
      for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      if (req.method === 'HEAD' || !response.body) { await response.body?.cancel(); res.end(); return; }
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (!controller.signal.aborted && !res.destroyed) logger.error(`[VidLink media] ${error.message}`);
      controller.abort();
      if (!res.headersSent && !res.destroyed) res.status(502).json({ error: 'Cannot relay the media source.' });
      else if (!res.destroyed) res.destroy();
    } finally { clearTimeout(timer); res.off('close', disconnected); }
  };
}

module.exports = { createProxyUrl, readTicket, rewritePlaylist, createProxyHandler };
