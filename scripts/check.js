'use strict';

const { once } = require('node:events');
const { createApp } = require('../src/server');
const { loadConfig } = require('../src/config');

async function check() {
  const args = process.argv.slice(2);
  const probe = args.includes('--probe');
  const positional = args.filter(arg => arg !== '--probe');
  const type = positional[0] || 'series';
  const id = positional[1] || 'tmdb:72351:1:25';
  const config = loadConfig();
  const server = createApp(config).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    config.publicUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`, { signal: AbortSignal.timeout(config.apiTimeoutMs * 2 + 5000) });
    const result = await response.json();
    const qualities = result.streams?.map(stream => ({ name: stream.name.replace('\n', ' '), description: stream.description, size: stream.behaviorHints.videoSize })) || [];
    console.log(JSON.stringify({ mode: 'live', type, id, streamCount: qualities.length, qualities, error: result.error || null }, null, 2));
    if (!qualities.length) { process.exitCode = 1; return; }
    if (probe) {
      for (const stream of result.streams) {
        const media = await fetch(stream.url, { headers: { ...(stream.behaviorHints.proxyHeaders?.request || {}), Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(config.apiTimeoutMs) });
        const range = media.headers.get('content-range');
        let prefix = Buffer.alloc(0);
        if (media.status === 206 && media.body) {
          const reader = media.body.getReader();
          try {
            while (prefix.length < 1024) {
              const part = await reader.read();
              if (part.done) break;
              prefix = Buffer.concat([prefix, Buffer.from(part.value)]);
            }
          } finally { await reader.cancel(); }
        } else { await media.body?.cancel(); }
        const mp4Header = prefix.subarray(4, 8).toString('ascii');
        console.log(`${stream.name.replace('\n', ' ')}: HTTP ${media.status}, Content-Range: ${range || '(none)'}, received ${prefix.length} bytes, MP4 box: ${mp4Header || '(none)'}`);
        if (media.status !== 206 || !range || prefix.length !== 1024 || mp4Header !== 'ftyp') process.exitCode = 1;
      }
    }
  } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}

check().catch(error => { console.error(error.message); process.exitCode = 1; });
