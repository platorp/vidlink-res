'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fixture = require('./fixtures/vidlink-response.json');
const { createToken, decodeToken } = require('../src/token');
const { parseId, createIdResolver } = require('../src/ids');
const { buildApiUrl, createVidlinkResolver } = require('../src/vidlink');
const { toStreams } = require('../src/streams');
const { loadConfig } = require('../src/config');
const { getJson, Cache } = require('../src/http');
const { createAddon } = require('../src/addon');
const { createApp } = require('../src/server');
const { createProxyUrl, readTicket, rewritePlaylist } = require('../src/proxy');

const config = loadConfig({});
const target = parseId('series', 'tmdb:72351:1:25');
const exampleToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAiaUkTZLik3MFeOjXugS808eBC8t8QFYZ2a6UG2g';
const silent = { error() {} };
const jsonResponse = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('encrypts and decrypts the exact supplied XSalsa20-Poly1305 vector', () => {
  assert.equal(createToken('72351', 1792971726), exampleToken);
  assert.deepEqual(decodeToken(exampleToken), {
    tmdbId: '72351', timestamp: 1792971726, payloadHex: '3732333531000000006ade93ce', nonceHex: '00'.repeat(24)
  });
  const bytes = Buffer.from(exampleToken, 'base64url');
  bytes[28] ^= 1;
  assert.throws(() => decodeToken(bytes.toString('base64url')), /authentication failed/);
  assert.throws(() => createToken('../72351'), /TMDB/);
});

test('tokens expire 120 seconds in the future and use exact TV/movie API paths', () => {
  const before = Math.floor(Date.now() / 1000);
  const defaultExpiry = decodeToken(createToken('72351')).timestamp;
  const after = Math.floor(Date.now() / 1000);
  assert.ok(defaultExpiry >= before + 120 && defaultExpiry <= after + 120);
  assert.notEqual(createToken('72351', 1792971726), createToken('72351', 1792971727));
  const url = new URL(buildApiUrl(target, config, 1792971726));
  assert.equal(url.pathname, `/api/b/tv/${exampleToken}/1/25`);
  assert.equal(url.search, '?multiLang=0');
  const movieUrl = new URL(buildApiUrl(parseId('movie', 'tmdb:603'), config, 1792971726));
  assert.equal(decodeToken(movieUrl.pathname.split('/').pop()).tmdbId, '603');
  assert.ok(movieUrl.pathname.startsWith('/api/b/movie/'));
});

test('accepts TMDB and IMDb episode IDs, including specials, and rejects malformed IDs', () => {
  assert.equal(parseId('series', 'tt1234567:0:1').season, 0);
  assert.equal(parseId('movie', 'tmdb:603').tmdbId, '603');
  for (const id of ['tmdb:72351', 'tmdb:72351:1:0', 'tmdb:72351:-1:2', 'tt1234567:1:2/3', 'tmdb:1:1:2:3']) assert.equal(parseId('series', id), null);
  assert.equal(parseId('movie', 'tt1234567:1:2'), null);
  assert.equal(parseId('tv', 'tmdb:72351:1:25'), null);
});

test('maps IMDb through Cinemeta once and preserves episode numbering', async () => {
  let calls = 0;
  const resolver = createIdResolver(config, async url => {
    calls++;
    assert.equal(url, `${config.cinemetaBaseUrl}/meta/series/tt1234567.json`);
    return jsonResponse({ meta: { moviedb_id: 72351 } });
  });
  assert.equal((await resolver('series', 'tt1234567:1:25')).tmdbId, '72351');
  assert.equal((await resolver('series', 'tt1234567:2:3')).episode, 3);
  assert.equal(calls, 1);
  assert.equal((await resolver('series', 'tmdb:72351:1:25')).tmdbId, '72351');
  assert.equal(calls, 1);
});

test('returns all supplied qualities in descending order without inventing missing qualities', () => {
  const streams = toStreams(fixture, target, config);
  assert.deepEqual(streams.map(stream => stream.name), ['VidLink\n1080p', 'VidLink\n480p', 'VidLink\n360p']);
  assert.equal(streams[0].behaviorHints.videoSize, 1022718528);
  assert.equal(streams[0].behaviorHints.filename, 'VidLink.72351.S01E25.1080p.h264.mp4');
  assert.equal(streams[0].behaviorHints.notWebReady, true, 'local HTTP relay requires the Stremio streaming server');
  assert.equal(streams[1].behaviorHints.notWebReady, true);
  assert.match(streams[1].description, /HEVC/);
});

test('stream responses do not contain both Stremio description aliases', () => {
  // Stremio core uses serde(alias = "title") for description. Both keys make
  // deserialization fail even when the JSON is valid and the media URLs work.
  const streams = JSON.parse(JSON.stringify(toStreams(fixture, target, config)));
  for (const stream of streams) {
    assert.equal(typeof stream.description, 'string');
    assert.ok(stream.description.length > 0);
    assert.equal(Object.hasOwn(stream, 'title'), false);
  }
});

test('formats two-line descriptions with actual size and average media bitrate', () => {
  const streams = toStreams(fixture, target, config, 2647.373);
  assert.equal(streams[0].description, '⚡ Direct · H264 · mwVault\n📊 3.1 Mbps · 📦 1.02 GB');
  assert.equal(streams[1].description, '⚡ Direct · HEVC · mwVault\n📊 0.4 Mbps · 📦 129.4 MB');
  assert.equal(streams[2].description, '⚡ Direct · HEVC · mwVault\n📊 0.2 Mbps · 📦 79.4 MB');
  for (const duration of [undefined, null, 0, -1, NaN]) {
    const noBitrate = toStreams(fixture, target, config, duration)[0];
    assert.ok(!noBitrate.description.includes('Mbps'));
    assert.ok(noBitrate.description.includes('📦 1.02 GB'));
    assert.ok(!noBitrate.description.includes('Cached'));
  }
});

test('requiresProxy produces the actual VidLink media-proxy URL with signing query intact', () => {
  const externalConfig = { ...config, mediaProxyUrl: 'https://media-proxy.example' };
  const streams = toStreams(fixture, target, externalConfig);
  for (const stream of streams) {
    const url = new URL(stream.url);
    assert.equal(url.origin, externalConfig.mediaProxyUrl);
    assert.ok(url.pathname.startsWith('/mp/'));
    assert.equal(url.searchParams.get('host'), 'https://bcdn.hakunaymatata.com');
    assert.equal(url.searchParams.get('headers'), '{}');
    assert.match(url.searchParams.get('sign'), /^[a-f0-9]{32}$/);
    assert.match(url.searchParams.get('t'), /^\d+$/);
  }
  assert.equal(fixture.stream.qualities['360'].url.startsWith('https://bcdn.'), true, 'conversion does not mutate source data');
});

test('direct mode preserves upstream URLs and Stremio request headers safely', () => {
  const data = structuredClone(fixture);
  data.stream.qualities['1080'].headers = { Referer: 'https://vidlink.pro/', 'Bad-Header': 'bad\r\nvalue', Host: 'untrusted.invalid' };
  const streams = toStreams(data, target, { ...config, proxyMode: 'never' });
  assert.equal(streams[0].url, data.stream.qualities['1080'].url);
  assert.deepEqual(streams[0].behaviorHints.proxyHeaders, { request: { Referer: 'https://vidlink.pro/' } });
  assert.equal(streams[0].behaviorHints.notWebReady, true);
});

test('includes available captions and HLS playlists, rejects unsafe or missing quality URLs', () => {
  const data = { stream: { qualities: { 1080: { url: 'javascript:alert(1)' }, 720: null }, playlist: 'https://media.example/video.m3u8', deliveryType: 'hls', requiresProxy: true,
    captions: [{ url: 'https://media.example/en.vtt', lang: 'eng' }, { url: 'file:///secret' }] } };
  const streams = toStreams(data, target, config);
  assert.equal(streams.length, 1);
  assert.ok(new URL(streams[0].url).pathname.startsWith('/proxy/'));
  assert.equal(streams[0].subtitles.length, 1);
  assert.equal(streams[0].subtitles[0].lang, 'eng');
  assert.equal(streams[0].behaviorHints.notWebReady, true);
});

test('resolver sends fresh authentication and playback headers, merges concurrent requests, respects TTL', async () => {
  let calls = 0;
  let probes = 0;
  const resolver = createVidlinkResolver(config, async (url, options) => {
    calls++;
    const token = new URL(url).pathname.split('/')[4];
    assert.ok(Math.abs(decodeToken(token).timestamp - Math.floor(Date.now() / 1000) - 120) < 2);
    assert.equal(options.headers['X-Playback-Environment'], 'standard');
    assert.equal(options.headers.Referer, 'https://vidlink.pro/tv/72351/1/25');
    return jsonResponse(fixture);
  }, async () => { probes++; return 2647.373; });
  const [a, b] = await Promise.all([resolver(target), resolver(target)]);
  assert.equal(a.data.sourceId, 'mwVault');
  assert.equal(a, b);
  assert.equal(a.ttlSeconds, 300);
  assert.equal(a.durationSeconds, 2647.373);
  assert.equal(calls, 1);
  await resolver(target);
  assert.equal(calls, 1);
  assert.equal(probes, 1);
});

test('cache expires, is bounded, and never retains failed requests', async () => {
  let time = 0;
  let calls = 0;
  const cache = new Cache(2, () => time);
  const load = async () => ({ value: ++calls, ttlSeconds: 1 });
  assert.equal(await cache.get('a', load), 1);
  assert.equal(await cache.get('a', load), 1);
  time = 1001;
  assert.equal(await cache.get('a', load), 2);
  await cache.get('b', load);
  await cache.get('c', load);
  assert.equal(cache.entries.size, 2);
  const fail = async () => { throw new Error('unavailable'); };
  await assert.rejects(cache.get('fail', fail));
  assert.equal(cache.pending.size, 0);
  assert.equal(cache.entries.has('fail'), false);
});

test('null API responses are explicit uncached failures, never fixture or expired streams', async () => {
  let calls = 0;
  const resolver = createVidlinkResolver(config, async () => { calls++; return jsonResponse(null); });
  const addon = createAddon(config, { resolveSource: resolver, logger: silent });
  for (let i = 0; i < 2; i++) {
    const result = await addon.get('stream', 'series', 'tmdb:72351:1:25');
    assert.deepEqual(result.streams, []);
    assert.equal(result.error.code, 'VIDLINK_NO_SOURCE');
    assert.equal(result.cacheMaxAge, 0);
  }
  assert.equal(calls, 2);
});

test('HTTP errors, non-JSON responses, and missing mappings produce clear errors', async () => {
  await assert.rejects(getJson('https://example.com', { fetchImpl: async () => new Response('denied', { status: 403 }) }), error => error.code === 'UPSTREAM_HTTP');
  await assert.rejects(getJson('https://example.com', { fetchImpl: async () => new Response('<html>blocked</html>') }), error => error.code === 'UPSTREAM_FORMAT');
  const resolver = createIdResolver(config, async () => jsonResponse({ meta: { name: 'No mapping' } }));
  await assert.rejects(resolver('movie', 'tt1234567'), error => error.code === 'ID_MAPPING');
});

test('Stremio HTTP manifest and stream routes expose every supplied quality with CORS', async () => {
  const server = createApp(config, { logger: silent, resolveSource: async () => ({ data: fixture, ttlSeconds: 300 }) }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const manifestResponse = await fetch(`${base}/manifest.json`);
    assert.equal(manifestResponse.headers.get('access-control-allow-origin'), '*');
    const manifest = await manifestResponse.json();
    assert.deepEqual(manifest.resources[0].idPrefixes, ['tt', 'tmdb:']);
    const preflight = await fetch(`${base}/stream/series/tmdb:72351:1:25.json`, { method: 'OPTIONS', headers: {
      Origin: 'https://web.stremio.com', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true'
    } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    const streamResponse = await fetch(`${base}/stream/series/tmdb:72351:1:25.json`);
    assert.equal(streamResponse.status, 200);
    assert.match(streamResponse.headers.get('cache-control'), /max-age=0/);
    const data = await streamResponse.json();
    assert.equal(data.streams.length, 3);
    const unsupported = await fetch(`${base}/stream/series/tmdb:72351.json`).then(response => response.json());
    assert.deepEqual(unsupported.streams, []);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});

test('configuration rejects invalid proxy modes, URLs, and timeouts', () => {
  assert.throws(() => loadConfig({ PROXY_MODE: 'maybe' }));
  assert.throws(() => loadConfig({ MEDIA_PROXY_URL: 'file:///tmp' }));
  assert.throws(() => loadConfig({ PUBLIC_URL: 'https://example.com/a' }));
  assert.throws(() => loadConfig({ API_TIMEOUT_MS: 'NaN' }));
  assert.throws(() => loadConfig({ PROXY_SECRET: 'too-short' }));
});

test('Render uses its assigned port and public HTTPS origin for playback URLs', () => {
  const renderConfig = loadConfig({ RENDER: 'true', PORT: '10000', RENDER_EXTERNAL_URL: 'https://vidlink-example.onrender.com', PROXY_SECRET: 'a'.repeat(43) });
  assert.equal(renderConfig.host, '0.0.0.0');
  assert.equal(renderConfig.port, 10000);
  assert.equal(renderConfig.publicUrl, 'https://vidlink-example.onrender.com');
  const stream = toStreams(fixture, target, renderConfig)[0];
  assert.equal(new URL(stream.url).origin, renderConfig.publicUrl);
  assert.equal(stream.behaviorHints.notWebReady, false);
  const custom = loadConfig({ RENDER: 'true', RENDER_EXTERNAL_URL: renderConfig.publicUrl, PUBLIC_URL: 'https://video.example.com', HOST: '127.0.0.1' });
  assert.equal(custom.publicUrl, 'https://video.example.com');
  assert.equal(custom.host, '127.0.0.1');
  assert.equal(loadConfig({}).host, '127.0.0.1');
});

test('local relay tickets preserve CDN signatures and reject tampering, expiry, and private destinations', () => {
  const streams = toStreams(fixture, target, config);
  const url = new URL(streams[0].url);
  assert.equal(url.origin, config.publicUrl);
  const ticket = url.pathname.split('/')[2];
  const decoded = readTicket(ticket, config);
  assert.equal(decoded.url, fixture.stream.qualities['1080'].url);
  assert.deepEqual(decoded.headers, {});
  assert.throws(() => readTicket(ticket, { ...config, proxySecret: 'another-secret' }), /signature/);
  const expired = new URL(createProxyUrl(decoded.url, {}, config, 'mp4', 1)).pathname.split('/')[2];
  assert.throws(() => readTicket(expired, config), error => error.status === 410);
  assert.throws(() => createProxyUrl('http://127.0.0.1/secret', {}, config));
  assert.throws(() => createProxyUrl('http://10.0.0.1/secret', {}, config));
});

test('HLS manifests keep relative playlists, segments, and encryption-key references on the signed relay', () => {
  const text = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\nvariant.m3u8\nseg01.ts\n';
  const ticket = { headers: { Referer: 'https://provider.example/' }, expires: Math.floor(Date.now() / 1000) + 500 };
  const rewritten = rewritePlaylist(text, 'https://cdn.example/folder/master.m3u8', ticket, config);
  assert.equal(rewritten.includes('URI="key.bin"'), false);
  const childUrls = [...rewritten.matchAll(/https?:\/\/[^\s"]+/g)].map(match => new URL(match[0]));
  assert.equal(childUrls.length, 3);
  const children = childUrls.map(url => readTicket(url.pathname.split('/')[2], config));
  assert.deepEqual(children.map(child => child.url), ['https://cdn.example/folder/key.bin', 'https://cdn.example/folder/variant.m3u8', 'https://cdn.example/folder/seg01.ts']);
  assert.equal(children[1].kind, 'hls');
  assert.equal(children[0].expires, ticket.expires);
});

test('relay serves real range bodies and HEAD metadata without forwarding browser-origin headers', async () => {
  const calls = [];
  const server = createApp(config, { logger: silent, mediaFetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(options.method === 'HEAD' ? null : Buffer.from('test'), { status: 206, headers: {
      'Content-Type': 'video/mp4', 'Content-Length': '4', 'Content-Range': 'bytes 10-13/1000', 'Accept-Ranges': 'bytes'
    } });
  } }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const ticketPath = new URL(createProxyUrl('https://cdn.example/video.mp4?sign=keep&t=123', {}, config)).pathname;
    const url = `http://127.0.0.1:${server.address().port}${ticketPath}`;
    const response = await fetch(url, { headers: { Range: 'bytes=10-13', Origin: 'https://app.strem.io', Referer: 'https://app.strem.io/', Cookie: 'client-private' } });
    assert.equal(response.status, 206);
    assert.equal(await response.text(), 'test');
    assert.equal(response.headers.get('content-range'), 'bytes 10-13/1000');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(calls[0].url, 'https://cdn.example/video.mp4?sign=keep&t=123');
    assert.equal(calls[0].options.headers.Range, 'bytes=10-13');
    for (const key of ['Origin', 'Referer', 'Cookie', 'User-Agent']) assert.equal(calls[0].options.headers[key], undefined);
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.headers.get('content-length'), '4');
    assert.equal(await head.text(), '');
    const forged = await fetch(url.replace('/video.mp4', 'x/video.mp4'));
    assert.equal(forged.status, 403);
    assert.equal(calls.length, 2);
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});

test('media connection timeout does not cut off a video body that is still streaming', async () => {
  const shortConfig = { ...config, apiTimeoutMs: 30 };
  const server = createApp(shortConfig, { logger: silent, mediaFetchImpl: async () => new Response(new ReadableStream({
    start(controller) { setTimeout(() => { controller.enqueue(new TextEncoder().encode('video')); controller.close(); }, 80); }
  }), { headers: { 'Content-Type': 'video/mp4' } }) }).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const ticketPath = new URL(createProxyUrl('https://cdn.example/video.mp4', {}, shortConfig)).pathname;
    const response = await fetch(`http://127.0.0.1:${server.address().port}${ticketPath}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'video');
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
});
