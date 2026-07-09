# image-proxy

Same file (`api/api.js`) runs on **Vercel Edge Functions** and **Deno Deploy**.

## API

```
GET <base>?url=<url-encoded image url>&token=<secret>
```

- `token` must equal the `PROXY_TOKEN` env var, else `403` (not an open proxy).
- Returns the image bytes with the upstream `Content-Type` and `Cache-Control: public, max-age=86400`.
- `400` bad/missing url · `502` upstream unreachable or not an image.

## Layout

```
api/api.js      the proxy function
vercel.json     rewrites "/" -> "/api/api" so the base URL is the bare domain
package.json    type: module
```

## Deploy

### Vercel
```bash
vercel                      # or: connect the repo in the Vercel dashboard
vercel env add PROXY_TOKEN  # set the secret (Production)
vercel --prod
```
Base URL: `https://<app>.vercel.app` (the `vercel.json` rewrite maps `/` to the function; `/api/api` also works).

### Deno Deploy
```bash
deployctl deploy --entrypoint api/api.js --prod
```
Set env `PROXY_TOKEN` in the Deno Deploy dashboard. Base URL: `https://<project>.deno.dev`

Deploy a few (different providers/regions) for resilience — each is one pool entry.
