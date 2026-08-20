# Friday setup

Friday replies inside `/host/` when a message begins with `@Friday`. The Worker
enforces a global daily limit, a per-device limit, a cooldown, a maximum response
length, and a short rolling chat context.

## One-time Cloudflare setup

From the Worker project directory, while signed in to the correct Cloudflare
account, create the Vectorize index used by reference documents:

```powershell
npx wrangler@latest vectorize create friday-knowledge --dimensions=1024 --metric=cosine
```

Create a long, private admin key for reference uploads. For a GitHub-connected
Worker, the simplest route is **Workers & Pages > getdcpfp > Settings > Variables
and Secrets > Add**. Use the name `FRIDAY_ADMIN_TOKEN`, select **Secret**, paste a
strong value, and deploy the setting.

The Wrangler equivalent is:

```powershell
npx wrangler@latest secret put FRIDAY_ADMIN_TOKEN
```

Enter the secret only when Wrangler prompts for it. Do not add it to this file,
`wrangler.jsonc`, GitHub, browser source, or a URL. Cloudflare's `secret put`
command deploys a Worker version immediately, so prefer the dashboard when the
code itself is deployed by GitHub.

The checked-in `wrangler.jsonc` already contains the Workers AI binding, the
Vectorize binding, and conservative default limits. Deploy after the index and
secret exist:

```powershell
npx wrangler@latest deploy
```

If GitHub deploys the Worker automatically, create the index and secret before
merging these changes, then let the GitHub deployment run.

## Using Friday

- Start a message with `@Friday`.
- Replies appear in the shared chat as Friday.
- Fenced code blocks are copied by clicking them once.
- Open the settings icon, enter the admin key, and choose a supported reference
  document to add it to Friday's knowledge.
- The admin key is kept in session storage for the open tab and is never included
  in ordinary chat requests.

## Default limits

- 20 model replies per UTC day across the room.
- 8 model replies per device per UTC day.
- 5 seconds between requests from one device.
- 600 maximum output tokens.
- 10 recent text messages supplied as conversation context.
- Four relevant reference sections retrieved per question.

The numeric defaults can be changed under `vars` in `wrangler.jsonc`. Keep the
Worker on the Free plan for a platform-level hard stop instead of paid overage.

## Local checks

```powershell
node --check worker.js
node --check public/host/host.js
node --test worker.test.mjs
```
