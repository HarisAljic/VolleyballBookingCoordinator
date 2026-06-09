# Deploying to Railway (Playwright court checks)

## Root cause

"Check venues" launches Playwright Chromium on the server. Railway's default Nixpacks image is a minimal Linux container without GUI-related libraries (`libglib-2.0.so.0`, etc.). `npm install` only downloads the browser binary; it does **not** install OS packages Chromium needs.

## Fix (recommended)

This repo includes a **Dockerfile** that:

1. Installs native build tools for `better-sqlite3`
2. Runs `npx playwright install-deps chromium` (apt system libraries)
3. Runs `npx playwright install chromium` (browser binary)

`railway.toml` sets Railway's builder to **Dockerfile** so production uses that image.

### Railway steps

1. Push this repo to GitHub (or connect your existing repo).
2. In Railway → your service → **Settings** → **Build**:
   - **Builder**: Dockerfile (should pick up `railway.toml` automatically on redeploy)
   - **Dockerfile path**: `Dockerfile`
3. Redeploy the service (new deploy required after adding the Dockerfile).
4. Smoke test: open a run, click **Check venues** — should return venue results instead of a 500.

No extra Railway env vars are required for Playwright.

### Local development (unchanged)

```bash
npm install   # postinstall downloads Chromium for macOS/Linux dev
npm run dev
```

`SKIP_PLAYWRIGHT_INSTALL=1` is only set in the Docker build so `postinstall` does not run before OS deps exist.

## Alternative: Nixpacks (no Dockerfile)

If you must use Nixpacks instead of Dockerfile:

1. Remove or ignore `railway.toml` builder override.
2. Add a **Build Command** in Railway:

   ```bash
   npm ci && npx playwright install-deps chromium && npx playwright install chromium
   ```

3. Ensure the Nixpacks image is Debian/Ubuntu-based so `install-deps` can use `apt`.

Dockerfile is more reproducible and is the supported path for this project.
