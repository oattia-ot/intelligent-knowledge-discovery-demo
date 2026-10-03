# Intelligent Knowledge Discovery Demo (Angular)

Internal Knowledge Discovery search UI — Angular 21 application.

## Requirements

- **Node.js** `^20.19 || ^22.12 || >=24` (use **22 LTS** — see `.nvmrc`)
- **Do not use Node 21** (odd non-LTS). It breaks Angular CLI with `ERR_REQUIRE_ESM` / yargs errors.
- npm 10+

```bash
# if using nvm
cd apps/web
nvm install 22   # once
nvm use          # reads .nvmrc → 22
node -v          # should show v22.x
```

## Commands

```bash
cd apps/web
nvm use
npm install --include=dev
./serve.sh          # preferred — host 0.0.0.0:4200, Node check, probe+admin servers
# or
npm start           # via scripts/dev.mjs
npm run start:local # localhost only
npm run build       # production → dist/web
./restart.sh        # kill :4200 then serve.sh
./sync-config.sh    # copy ../../config → src/assets/config
```

Full installation instructions, architecture, and configuration notes are in the **root README.md**.

## Structure

```
src/app/
  core/           guards, services, models, i18n
  features/       login, search, settings, chat, home
  shared/         header, footer, pipes
src/assets/config/  databases, fields, facets, theme, endpoint-health
src/environments/
```

## Theme

CSS variables in `src/styles/_tokens.scss` (demo gold theme).
