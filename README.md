# VidLink · All Qualities

A Stremio add-on that resolves VidLink movie and TV sources and lists every available quality separately. Supports IMDb and TMDB IDs, fresh expiring tokens, captions, and a signed media relay with byte-range seeking.

## Deploy on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fplatorp%2Fvidlink-res)

1. Click **Deploy to Render** and sign in.
2. Review the Blueprint and keep the service on the **Free** plan.
3. Deploy and wait until the service says **Live**.
4. Open your service's `/health` endpoint, then install its HTTPS URL followed by `/manifest.json` in Stremio.

The Dockerfile includes Node.js 22 and FFmpeg, including `ffprobe` for the bitrate labels. The add-on automatically uses Render's assigned port and HTTPS address. The Blueprint generates a stable `PROXY_SECRET` for relay links. No local `.env` file is required on Render.

See [RENDER-SETUP.md](RENDER-SETUP.md) for verification and troubleshooting.

Render Free sleeps after 15 minutes without inbound traffic. Its Hobby workspace includes 5 GB/month outbound bandwidth, and the video relay consumes that allowance. See Render's [free-service limitations](https://render.com/docs/free) and [bandwidth documentation](https://render.com/docs/outbound-bandwidth).

## Run locally

Requires Node.js 22.14 or newer. Install FFmpeg if you want average bitrate in descriptions; streams remain available without it.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm start
```

The default manifest URL is `http://127.0.0.1:7001/manifest.json`. Copy `.env.example` to `.env` to change local settings. Keep private settings out of Git.

## Example descriptions

```text
VidLink 1080p
⚡ Direct · H264 · mwVault
📊 3.1 Mbps · 📦 1.02 GB
```

Mbps is average media bitrate calculated from file size and measured duration, rather than download speed. VidLink does not report a verified debrid cache status, so streams are labeled Direct.

## Supported IDs

| Content | Example |
| --- | --- |
| Movie by IMDb | `tt0133093` |
| Movie by TMDB | `tmdb:603` |
| Episode by IMDb | `tt0163450:1:25` |
| Episode by TMDB | `tmdb:72351:1:25` |

Series use the Stremio content type `series`. IMDb IDs are mapped through Cinemeta without a TMDB API key.

## Checks

```sh
npm test
npm run check -- series tmdb:72351:1:25 --probe
```

The automated suite covers authentication, IDs, descriptions, response compatibility, caching, signed relay requests, range seeking, and Render configuration. The live check verifies every returned MP4 stream with a small byte-range request.

Render deployment and VidLink access from Render's network still need verification after the first deploy.

## License

[MIT](LICENSE)
