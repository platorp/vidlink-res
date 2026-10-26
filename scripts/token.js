'use strict';

const { createToken, decodeToken } = require('../src/token');

try {
  const [value, argument] = process.argv.slice(2);
  if (!value) throw new Error('Usage: npm run token -- 72351 [expiryTimestamp] OR npm run token -- --decode TOKEN');
  const token = value === '--decode' ? argument : createToken(value, argument === undefined ? undefined : Number(argument));
  const decoded = decodeToken(token);
  console.log(JSON.stringify({ token, ...decoded, expiresAt: new Date(decoded.timestamp * 1000).toISOString() }, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
