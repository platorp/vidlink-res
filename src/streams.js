'use strict';

const { mediaUrl, cleanHeaders } = require('./media');
const { createProxyUrl } = require('./proxy');

function proxiedUrl(url, headers, config, kind = 'mp4') {
  if (!config.mediaProxyUrl) return createProxyUrl(url, headers, config, kind);
  // Same media-proxy contract used by the public VidLink player.
  const query = new URLSearchParams();
  const signedKeys = new Set(['auth', 'expires', 'hash', 'key', 'sign', 't', 'token']);
  for (const [name, value] of url.searchParams) {
    if ((kind !== 'mp4' || signedKeys.has(name.toLowerCase())) && !['headers', 'host', 'sc'].includes(name.toLowerCase())) query.append(name, value);
  }
  const sortedHeaders = Object.fromEntries(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)));
  query.set('headers', JSON.stringify(sortedHeaders));
  query.set('host', url.origin);
  return `${config.mediaProxyUrl}/${kind === 'mp4' ? 'mp' : 'proxy'}${url.pathname}?${query}`;
}

function displaySize(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

function toStreams(data, target, config, durationSeconds) {
  const stream = data?.stream;
  if (!stream) return [];
  const source = String(data.sourceId || 'VidLink');
  const entries = Object.entries(stream.qualities || {}).map(([quality, value]) => ({ quality, value }));
  if (typeof stream.playlist === 'string' && stream.deliveryType !== 'dash') {
    entries.push({ quality: 'Auto', value: { url: stream.playlist, type: 'hls', headers: stream.playlistHeaders, requiresProxy: stream.requiresProxy } });
  }
  entries.sort((a, b) => (parseInt(b.quality, 10) || 0) - (parseInt(a.quality, 10) || 0));
  return entries.flatMap(({ quality, value }) => {
    if (!value || typeof value !== 'object') return [];
    const url = mediaUrl(value.url);
    if (!url) return [];
    const headers = cleanHeaders(value.headers);
    const kind = value.type === 'hls' || /\.m3u8$/i.test(url.pathname) ? 'hls' : 'mp4';
    const shouldProxy = config.proxyMode === 'always' || (config.proxyMode === 'auto' && (value.requiresProxy === true || Object.keys(headers).length > 0));
    const playbackUrl = shouldProxy ? proxiedUrl(url, headers, config, kind) : url.href;
    const resolution = /^\d+$/.test(quality) ? `${quality}p` : quality;
    const codec = String(value.codecName || '').replace(/[^a-zA-Z0-9._-]/g, '');
    const episodeLabel = target.type === 'series' ? `.S${String(target.season).padStart(2, '0')}E${String(target.episode).padStart(2, '0')}` : '';
    const extension = kind === 'hls' ? 'm3u8' : 'mp4';
    const bitrate = Number(value.size) * 8 / durationSeconds / 1e6;
    const details = [
      Number.isFinite(bitrate) && bitrate > 0 && `📊 ${bitrate.toFixed(1)} Mbps`,
      displaySize(value.size) && `📦 ${displaySize(value.size)}`
    ].filter(Boolean).join(' · ');
    const description = [[ '⚡ Direct', codec && codec.toUpperCase(), source ].filter(Boolean).join(' · '), details].filter(Boolean).join('\n');
    const behaviorHints = {
      bingeGroup: `vidlink-${source}-${resolution}-${codec}`,
      filename: `VidLink.${target.tmdbId}${episodeLabel}.${resolution}${codec ? `.${codec}` : ''}.${extension}`,
      notWebReady: kind !== 'mp4' || new URL(playbackUrl).protocol !== 'https:' || /hevc|h265|x265/i.test(codec)
    };
    const size = Number(value.size);
    if (Number.isSafeInteger(size) && size > 0) behaviorHints.videoSize = size;
    if (!shouldProxy && Object.keys(headers).length > 0) {
      behaviorHints.proxyHeaders = { request: headers };
      behaviorHints.notWebReady = true;
    }
    const subtitles = (Array.isArray(stream.captions) ? stream.captions : []).flatMap((caption, index) => {
      const captionUrl = mediaUrl(caption?.url || caption?.file);
      return captionUrl ? [{ id: String(caption.id || `vidlink-${index}`), url: captionUrl.href, lang: String(caption.lang || caption.language || 'und') }] : [];
    });
    // Stremio aliases "title" to "description"; emitting both is a duplicate
    // field during deserialization and makes the client reject the response.
    return [{ name: `VidLink\n${resolution}`, description, url: playbackUrl, behaviorHints, ...(subtitles.length ? { subtitles } : {}) }];
  });
}

module.exports = { toStreams, proxiedUrl, cleanHeaders };
