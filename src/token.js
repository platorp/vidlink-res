'use strict';

const nacl = require('tweetnacl');

const DEFAULT_KEY_HEX = 'c75136c5668bbfe65a7ecad431a745db68b5f381555b38d8f6c699449cf11fcd';

function getKey(keyHex = process.env.VIDLINK_KEY_HEX || DEFAULT_KEY_HEX) {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('VIDLINK_KEY_HEX must contain 64 hexadecimal characters.');
  return Buffer.from(keyHex, 'hex');
}

// The public player's Go/WASM generator uses time.Now().Unix() + 120.
// This field is an expiry, not the token's creation time.
function createToken(tmdbId, timestamp = Math.floor(Date.now() / 1000) + 120, keyHex) {
  if (!/^[1-9]\d*$/.test(String(tmdbId))) throw new Error('Invalid TMDB ID.');
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('Invalid Unix timestamp.');
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(timestamp));
  const payload = Buffer.concat([Buffer.from(String(tmdbId), 'ascii'), time]);
  // VidLink's supplied wire format: zero nonce, MAC, ciphertext; URL-safe base64.
  const nonce = Buffer.alloc(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(payload, nonce, getKey(keyHex));
  return Buffer.concat([nonce, Buffer.from(encrypted)]).toString('base64url');
}

function decodeToken(token, keyHex) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(token)) throw new Error('Invalid token encoding.');
  const data = Buffer.from(token, 'base64url');
  if (data.length < 49) throw new Error('Token is too short.');
  const nonce = data.subarray(0, 24);
  const opened = nacl.secretbox.open(data.subarray(24), nonce, getKey(keyHex));
  if (!opened) throw new Error('Token authentication failed.');
  const payload = Buffer.from(opened);
  const tmdbId = payload.subarray(0, -8).toString('ascii');
  if (!/^[1-9]\d*$/.test(tmdbId)) throw new Error('Token has an invalid TMDB ID.');
  const timestamp = payload.readBigUInt64BE(payload.length - 8);
  if (timestamp > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Token timestamp is out of range.');
  return { tmdbId, timestamp: Number(timestamp), payloadHex: payload.toString('hex'), nonceHex: nonce.toString('hex') };
}

module.exports = { createToken, decodeToken };
