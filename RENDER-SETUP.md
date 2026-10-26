# Deploy VidLink on Render Free

This package includes a Docker image definition with Node.js 22 and FFmpeg, so the relay and Mbps descriptions can run on Render. The included `render.yaml` selects the Free plan and generates a persistent relay-signing secret.

## 1. Open the deployment

The source is in [platorp/vidlink-res](https://github.com/platorp/vidlink-res), with `Dockerfile`, `render.yaml`, and `package.json` at the repository root.

Use the [Deploy to Render button](https://render.com/deploy?repo=https%3A%2F%2Fgithub.com%2Fplatorp%2Fvidlink-res), or follow the Blueprint steps below.

Private `.env` files, installed dependencies, PC-specific addresses, logs, and local verification artifacts are not included. Keep local `.env` files out of the repository.

## 2. Create the Render service

1. Sign in to [Render](https://dashboard.render.com/).
2. Choose **New → Blueprint** and connect the GitHub repository.
3. Confirm the `vidlink-addon` service is on the **Free** plan, then deploy it.

Render reads `render.yaml`. No database, disk, custom domain, build command, or paid service is required. The Docker image supplies its own startup command. The app automatically uses Render's assigned port and public HTTPS address.

If you already started with **New → Web Service**, choose **Docker** and **Free**, leave the Docker command at its default, and set the health-check path to `/health`. Add a `PROXY_SECRET` environment variable containing a random value of at least 32 characters. The Blueprint generates this value automatically; the manual Web Service flow does not.

Leave `PUBLIC_URL` unset when using the default Render address. Leave `MEDIA_PROXY_URL` unset to retain the built-in relay. Do not copy a temporary tunnel address into Render.

## 3. Verify before installing

After the service says **Live**, copy its actual `https://...onrender.com` address from the Render dashboard. Open:

- `/health` — should return `"ok": true`.
- `/stream/series/tt0163450:1:25.json` — should list 1080p, 480p, and 360p for the test episode.
- One returned stream URL — should be on the Render HTTPS address and return video.

VidLink access from Render's servers has not been verified yet. If the stream response is empty, inspect Render's Logs for the upstream error before installing the add-on. The logs distinguish API errors from an unsupported title ID.

## 4. Install in Stremio

Paste your actual Render address followed by `/manifest.json` into Stremio's Add-ons installation field. Use this new installation on your Stremio account and reopen the episode.

After deployment, Render runs the add-on independently of your PC. The existing PC tunnel can be stopped once the Render manifest and playback have been verified.

## Free-plan limits

- A Free web service sleeps after 15 minutes without inbound traffic; waking it can take about a minute. If Stremio's first request times out, open `/health`, wait until it responds, and reopen the episode.
- The Hobby workspace includes 5 GB/month outbound bandwidth. The relay sends the full video through Render, so ordinary viewing can use that allowance quickly. With no payment method, reaching the allowance suspends Free services for the rest of the month; with a payment method, additional usage can be billed.
- Render can suspend a Free service for unusually high service-initiated traffic. This package does not establish that sustained video relaying will remain supported on the Free plan.

Official references: [Free services](https://render.com/docs/free), [bandwidth](https://render.com/docs/outbound-bandwidth), [Docker](https://render.com/docs/docker), [Blueprints](https://render.com/docs/blueprint-spec), and [automatic environment variables](https://render.com/docs/environment-variables).

## Validation performed here

The Node.js tests cover the Render port, host binding, public URL selection, and HTTPS relay URLs. Docker is not installed on this computer, so the image has not been built locally. Its first actual build and server-side VidLink check will happen on Render.
