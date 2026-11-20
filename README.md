# Blackboard Studio Alpha

An earlier public release of **Blackboard Studio**, a browser-based, node-based workspace for visual effects and compositing.

**[Try the Alpha](https://promto-c.github.io/blackboard-studio-alpha/)** · **[Latest hosted edition](https://xn--b1a.studio/)**

## About this release

This repository preserves an older alpha edition (Studio v0.0.25). The latest hosted edition is developed separately and may have different features and behavior. Releases from this repository do not automatically track the latest edition.

Features in this release include node-based image and video compositing, GPU-assisted rendering,
timeline and keyframe tools, roto workflows, project storage, and optional external integrations.
Some features depend on compatible browser APIs, local services, or separately downloaded models.

## Run locally

Requires Node.js 22 and pnpm 9.13.2.

```bash
pnpm install --frozen-lockfile
pnpm dev:studio
```

To validate the production build (including the GitHub Pages asset boundary):

```bash
pnpm build
```

The standalone Alpha site is deployed from `.github/workflows/deploy-studio.yml` to
`/blackboard-studio-alpha/`. No part of this setup requires the private development repository.

## Support Development

Blackboard Studio is an independently developed project.

If you find it useful, consider [sponsoring its development](https://github.com/sponsors/promto-c). Your support helps fund ongoing development, maintenance, and future public-source releases.

Thank you for supporting Blackboard Studio!

## Source and third-party licensing

A license for Blackboard Studio Alpha's own source has **not yet been selected**. Public availability does not, by itself, grant permission to redistribute or modify the source. See [third-party notices](THIRD_PARTY_NOTICES.md) for dependency licensing information.
