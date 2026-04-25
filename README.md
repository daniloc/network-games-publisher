# Network Games Publisher

An Obsidian plugin for authoring posts to the [Network Games](https://networkgames.fyi) blog (`daniloc/network-games-svelte`) directly from Obsidian on desktop or mobile.

## How it works

This plugin treats GitHub as the source of truth for posts. There is no git client on the device — every read and write goes through the GitHub Contents API via Obsidian's `requestUrl` (which is CORS-free and works identically on iOS). Cloudflare Pages auto-deploys the site on push to `main`.

The Obsidian vault contains only post markdown files. Repo-level concerns (the `_redirects` file, build config, etc.) are handled silently by the plugin via the same API.

## Status

v0.1.0 — scaffolding only. Settings tab + sanity-check command. No publishing commands implemented yet.

## Requirements

- A GitHub fine-grained personal access token, repo-scoped to the blog repo, with `Contents: Read & Write`.
- A Cloudflare API token with `Cloudflare Pages: Read` permission, plus the account ID and Pages project name (for deploy-status integration).

Configure both in Settings → Network Games Publisher.

## Install (development)

```sh
npm install
npm run dev
```

Then symlink (or BRAT) the build output into `<vault>/.obsidian/plugins/network-games-publisher/`.
