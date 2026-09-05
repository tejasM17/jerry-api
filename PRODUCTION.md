# Jerry API — production (Render)

Service URL: `https://jerry-api-d34t.onrender.com`

## Dashboard environment variables

Set these on the Render service (Environment). Do **not** rely on `.env` files in production — the server ignores them when `NODE_ENV=production`.

```env
NODE_ENV=production
MONGODB_URI=your_mongodb_connection_string
FRONTEND_URL=https://your-frontend.vercel.app

FIREBASE_PROJECT_ID=jerry999-a281d
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@jerry999-a281d.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

GEMINI_API_KEY=your_gemini_api_key
```

Optional:

```env
# Extra allowed CORS origins (comma-separated, no trailing slashes)
CORS_ORIGINS=https://another-custom-domain.com
# Allow all *.vercel.app preview deployments
ALLOW_VERCEL_PREVIEWS=true
GEMINI_MODEL=gemini-2.5-flash
MONGODB_PASSWORD=...   # only if MONGODB_URI still contains <db_password>
```

### `FIREBASE_PRIVATE_KEY`

Paste the full PEM as **one line** with `\n` for newlines, wrapped in quotes. Render sometimes stores extra quotes; the server strips them.

### `FRONTEND_URL`

Must match the Vercel origin **exactly**, including `https://`, **no trailing slash**. This is what CORS uses for the SPA.

## Checks after deploy

```bash
curl https://jerry-api-d34t.onrender.com/health
```

Expect `"auth":"firebase"`, `"firebase":"configured"`, `"mongo":"connected"`, `"gemini":"configured"`.
