# OpenRouter Video Studio

A self-hosted studio for generating and analyzing video with your own OpenRouter API key. The interface is capability-driven: it reads the current OpenRouter model catalog and applies documented capability overrides instead of being tied to one model family.

## Features

- Text-to-video, first-frame generation, multiple image/video references, and Motion Control for compatible models
- Seedance, Wan, MiniMax H3, and other video models available through OpenRouter
- Asynchronous jobs, polling recovery, local history, preview, and download
- Gemini video analysis with ready-to-use prompts for Wan and MiniMax
- A local prompt collection
- Public TikTok video import through optional `yt-dlp`
- Local EXIF/XMP/QuickTime/C2PA cleanup and metadata transfer for MP4 and image files
- A demo mode with no network requests or charges

Your API key stays in the local `.env` file on the backend. History, collections, uploads, and results are stored in `data/`, which is excluded from Git.

## Quick start

Requires [Node.js 22.13+](https://nodejs.org/).

### Windows

Download the repository and double-click **`Start Video Studio.cmd`**. On the first run, dependencies are installed automatically and the setup wizard lets you choose demo mode or enter an OpenRouter API key.

### macOS and Linux

```sh
chmod +x start-video-studio.sh
./start-video-studio.sh
```

### Terminal

```sh
npm ci
npm run setup
npm start
```

The studio opens at `http://127.0.0.1:3001`. Choose demo mode to test the interface without spending money. A paid request is sent only when you explicitly start video generation or Gemini analysis.

## Video references and Motion Control

Images are sent directly to OpenRouter. A local MP4 must be reachable by the model through a public HTTPS URL. The recommended option is your own temporary Cloudflare Media Worker:

```sh
npm run setup:worker
```

This command signs in to Wrangler, creates a private KV namespace, deploys the Worker, generates a random upload secret, and stores the URL and secret only in your local `.env`. Uploaded files receive random URLs and expire after 24 hours.

Cloudflare is optional. You can paste direct public HTTPS links or configure `PUBLIC_ASSET_BASE_URL`. Do not expose the complete Express backend to the internet; it is designed as a single-user local application and has no multi-user authentication.

## Docker

Create `.env` with `npm run setup`, then run:

```sh
docker compose up --build -d
```

The container port is published only on `127.0.0.1:3001`, while `./data` is mounted as persistent local storage.

## Validation and backups

```sh
npm run doctor
npm run check
npm run backup
```

`npm run check` runs the test suite, production build, dependency diagnostics, and a public-file scan for API keys, personal paths, and Cloudflare resource IDs. These checks do not contact OpenRouter and do not spend credits.

`npm run backup` copies history, collections, uploads, results, and built-in prompts to `.studio-backups/`. The `.env` file and API key are intentionally excluded.

## Documentation

- [Configuration](docs/CONFIGURATION.md)
- [Architecture and local data](docs/ARCHITECTURE.md)
- [Development and releases](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [RALPH roadmap](RALPH.md)

Licensed under the [MIT License](LICENSE).
