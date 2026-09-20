# Configuring and running Custard Cream Server

## Prerequisites

- Node.js 20.x and npm 9+ (see `engines` in `package.json`).
- A MongoDB database — this server is designed to share the same MongoDB Atlas cluster and `User` collection as [box-server](https://github.com/CrazyRobMiles/box-server) ("Connected Little Boxes"), so accounts are shared between the two sites. It will work against any MongoDB instance, but the `User` schema in `schemas/user.js` must match whatever already has accounts in it.

### Installing Node.js on a Raspberry Pi

Raspberry Pi OS's own `apt` repos lag well behind current Node releases — `sudo apt install nodejs` typically pulls something like Node 18 or older, which doesn't satisfy the `>=20 <21` requirement in `package.json`'s `engines`. Use [NodeSource's](https://github.com/nodesource/distributions) setup script instead, which adds a repo that tracks current releases and then installs from `apt` as normal:

```
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

This works on Raspberry Pi OS (32-bit or 64-bit, it detects the right architecture) as well as other Debian/Ubuntu-based systems. Confirm the installed version afterwards:

```
node -v   # should print v20.x
npm -v    # should be 9 or higher
```

If a Pi already has an old `nodejs` package installed from `apt`, remove it first (`sudo apt-get remove nodejs`) before running the NodeSource script, to avoid the two conflicting.

## Install

```
npm install
```

## Database (Mongoose / MongoDB)

The server uses [Mongoose](https://mongoosejs.com/) to talk to MongoDB. It's a normal `dependencies` entry in `package.json`, so `npm install` (above) installs it — there's nothing extra to set up beyond having a MongoDB database to point at.

**Connection string**: put it in `DATABASE_URL` in `.env` (see the settings table below). `manager.js` reads it and calls `mongoose.connect(dbUrl, options)` on startup, before the server starts listening. A [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) connection string looks like:

```
mongodb+srv://dbUser:password@cluster0.example.mongodb.net/dbUser?retryWrites=true&w=majority
```

Use the **same** `DATABASE_URL` as box-server's `.env` if you want the two apps to share accounts and pictures data — see Prerequisites above.

### Schemas

Both models live under `schemas/` and are used as-is by `mongoose.model(...)` — no separate migration step, MongoDB creates collections on first write.

**`schemas/user.js`** — collection `users` (Mongoose's default pluralization of `User`), shared with box-server:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | String | Yes | |
| `password` | String | Yes | bcrypt hash, not plaintext. |
| `role` | String | Yes | Not an enum in the schema — values actually used by this server are `"camera"` (the bootstrap camera account, see below) and `"admin"`. `behaviours/requireRole.js` checks this against a per-route allow-list. |
| `email` | String | Yes | |
| `lastLoginDate` | Date | Yes | Defaults to the time the document was constructed. |

**`schemas/picture.js`** — collection `pictures` by default, or whatever `PICTURES_COLLECTION` is set to (see below):

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `phrase` | String | Yes, unique | The three-word address, e.g. `oak-larch-feather`. |
| `filename` | String | Yes | Random GUID filename under `public/pictures/` — see "Where pictures are stored" below. |
| `originalName` | String | Yes | Original filename as uploaded. |
| `mimeType` | String | Yes | e.g. `image/jpeg`. |
| `uploadedBy` | ObjectId | Yes | References a `User` document. |
| `uploadedAt` | Date | Yes | Defaults to upload time. |
| `tags` | String | No, defaults to `''` | Comma-separated, e.g. `emf2026,workshop`. |
| `aiInstruction` | String | No, defaults to `''` | AI Edit prompt used to produce this image, if any. |
| `originalPhrase` | String | No, defaults to `''` | Phrase of the source picture, if this one is an AI-edited derivative. |

See "Uploading a picture" and "Managing pictures" below for how these fields are populated and edited.

## `.env` settings

Copy `.env.example` to `.env` and fill in real values. `.env` is gitignored and must never be committed.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | MongoDB connection string. Use the **same** value as box-server's `.env` if you want accounts shared between the two apps. |
| `ACTIVE_TOKEN_SECRET` | Secret used to sign/verify login JWTs. Use the **same** value as box-server's `.env` for consistency, since both apps read/write the same `User` collection. |
| `PORT` | Port to listen on locally. In production, most hosts (Heroku, Azure App Service, etc.) inject their own `PORT` and this is ignored. |
| `HOST_ADDRESS` | The public base URL of this server (with a trailing slash), used to build absolute picture URLs returned to the camera, e.g. `http://localhost:3100/`. |
| `PICTURES_COLLECTION` | Optional. Leave unset for normal/production use. Set it to point the whole app (and every script in `scripts/`) at a different MongoDB collection instead of the real `pictures` one - see "Testing locally" below. |
| `CAMERA_ACCOUNT_EMAIL` / `CAMERA_ACCOUNT_PASSWORD` | Credentials for the dedicated camera account, auto-created on first startup (see below) if no user with this email already exists. |
| `GOOGLE_API_KEY` | Gemini API key for the **AI Edit** button on `/manage` (see below). Get one from https://aistudio.google.com/apikey — this can be the same key custard-cream-camera uses as `GOOGLE_API_KEY` in its own `secrets.sh`. Only needed if you want to use AI Edit. |

## The camera account

Posting a picture requires a logged-in account with role `"camera"` or `"admin"` (see `behaviours/requireRole.js`). On startup, `manager.js`'s `checkForCameraUser()` looks for a `User` document with email `CAMERA_ACCOUNT_EMAIL`; if none exists, it creates one with role `"camera"` and the bcrypt-hashed `CAMERA_ACCOUNT_PASSWORD`.

To rotate the camera's password later: change `CAMERA_ACCOUNT_PASSWORD` in `.env`, then update the matching `User` document's password hash directly (there's currently no admin UI for this) — or delete the `User` document and restart the server to have it recreated with the new password.

Configure the camera itself (custard-cream-camera) to point at this server and use these same credentials — see its `settings.json` (`publish.custard_cream_server.base_url`) and `secrets.sh` (`CUSTARD_CREAM_SERVER_EMAIL` / `CUSTARD_CREAM_SERVER_PASSWORD`).

## Running

```
npm run devstart   # nodemon, auto-restarts on file changes
npm start          # plain node, for production
```

On startup the server connects to MongoDB, ensures the camera account exists, then starts listening. Look for `Server listening on: <port>` in the log.

## Where pictures are stored

Uploaded images are written to `public/pictures/` on local disk (not in MongoDB) and served directly via `express.static`. MongoDB only stores metadata (`schemas/picture.js`): the three-word phrase, filename, uploader, and upload time.

The on-disk filename is a random GUID (`crypto.randomUUID()`), deliberately unrelated to the three-word phrase — so browsing `public/pictures/` or knowing a raw file URL can't reveal which words point at which picture. Finding a picture always goes through the phrase → `Picture` database lookup in `pages/pictures.js`, never a direct filename guess.

This means:
- `public/pictures/` needs to persist across restarts/deploys — on a host with an ephemeral filesystem (e.g. Heroku dynos), uploaded pictures will be lost on redeploy. For durability in that kind of environment, you'd need to move storage to a persistent volume or object storage — not currently implemented.
- Back up `public/pictures/` alongside the database if you care about not losing pictures.

## One-off maintenance scripts

`scripts/` holds small one-shot scripts for bulk database changes, run manually with `node scripts/<name>.js` (they load `.env` themselves via `dotenv`). Currently:

- `scripts/addTag.js [tag]` — adds a tag to every existing `Picture` document's `tags` field, skipping ones that already have it. Defaults to `emf2026` if no tag is given.
- `scripts/backupPictures.js` — copies every existing `Picture` document into a separate `PictureBackup` collection (upserted by original `_id`), as a snapshot before running other bulk changes. Never deletes anything from either collection.
- `scripts/seedTestPictures.js` — seeds a `Picture` document for every image file actually present in `public/pictures/` on this machine, into whichever collection `PICTURES_COLLECTION` points at. Refuses to run unless `PICTURES_COLLECTION` is set, so it can never seed fake data into the real `pictures` collection. Safe to re-run — files that already have a matching document (by filename) are skipped.

## Testing locally

The shared MongoDB database (see Prerequisites above) is real production data — the real `pictures` collection has far more `Picture` documents than there are files in this machine's `public/pictures/` folder, since pictures uploaded elsewhere never get copied down here. Two consequences:

- Browsing pictures that reference a missing file is harmless: the server serves a placeholder image instead of a broken image (see the `/pictures` fallback middleware in `server.js`).
- But *creating or editing* `Picture` documents while pointed at the real collection (e.g. testing the `/manage` page) would touch production data, potentially leaving documents that reference files no other environment has either.

To test safely instead:

1. Set `PICTURES_COLLECTION=testpictures` (or any name you like) in your local `.env`.
2. Run `node scripts/seedTestPictures.js` to populate it with one `Picture` document per file already in `public/pictures/`.
3. Start the server as normal (`npm run devstart`) — with `PICTURES_COLLECTION` set, the server and every `scripts/*.js` script transparently read/write that collection instead of `pictures`, so uploads, edits, and deletes during testing never touch production data.
4. Unset `PICTURES_COLLECTION` (or remove it) to go back to the real collection.

## The three-word word list

`wordlist.json` at the repo root is the pool of words used to build phrases like `oak-larch-feather` (see `behaviours/threeWordPhrase.js`). It's a plain JSON array of lowercase words — edit it freely to add more variety; there's no fixed format beyond "array of strings with no hyphens in them".

## Auth notes for API/device clients

`POST /login` responds differently depending on the request's `Accept` header:
- `Accept: application/json` → `{ "token": "...", "expiresIn": 6000 }` in the response body (what the camera uses).
- Otherwise → sets a `token` cookie and redirects (what a browser gets).

Authenticated requests can send the token either as a cookie or as `Authorization: Bearer <token>` — the latter is what the camera uses, since it isn't a browser and has no cookie jar.

## Uploading a picture (`POST /pictures`)

Requires the `Authorization: Bearer <token>` header from a logged-in account with role `"camera"` or `"admin"`, and a `multipart/form-data` body with these fields:

| Field | Required? | Purpose |
| --- | --- | --- |
| `image` | Required | The picture file itself. Must be `image/jpeg` or `image/png`, up to 15MB. |
| `tags` | Optional | A comma-separated list of tags, e.g. `emf2026,workshop` — lets a picture be associated with an event or category. Defaults to `''` (no tags) if omitted. |
| `aiInstruction` | Optional | The AI instruction/prompt the camera used to process this image, if any (e.g. an edit prompt). Defaults to `''` if omitted. |
| `originalPhrase` | Optional | The three-word phrase of the picture this one was derived from, if this upload is an AI-edited version of an already-published photo. Defaults to `''` if omitted. |

All three optional fields are stored as-is on the `Picture` document (`schemas/picture.js`) and are otherwise untouched by the server — there's no validation beyond trimming whitespace. They can be viewed and edited afterwards on the `/manage` page (see below).

On success, the response is `201 { "url": "...", "phrase": "..." }`, same as before — adding these fields doesn't change the response shape.

## Managing pictures (`/manage`)

A login-protected page for browsing, editing, and deleting pictures — there's no link to it anywhere on the site (by design, see below); go to `/manage` directly.

- Requires a logged-in session (cookie) for a `User` with role `"camera"` — `admin` is *not* included here, unlike the upload endpoint. Visiting `/manage` while logged out redirects to `/login?next=/manage`, and a successful login sends you back to `/manage` instead of the homepage.
- Shows a 3×3 paginated grid of pictures (newest first), with a tag filter dropdown. Page forward/back with the on-page buttons or the ← / → arrow keys.
- Clicking a thumbnail opens it full-screen with its three-word phrase (read-only) and editable `tags`, `aiInstruction`, and `originalPhrase` fields. **Save** writes the edited fields back to the `Picture` document; **Delete** removes the `Picture` document only — the image file under `public/pictures/` is left in place (same as the maintenance scripts above).
- **AI Edit**: enter a prompt and click **AI Edit** to send the picture to Gemini's `gemini-2.5-flash-image` model ("Nano Banana" — the same model and API key custard-cream-camera uses, see `NanoBananaClient.py` there and `behaviours/nanoBanana.js` here) for an AI-edited version. This never overwrites the original — it saves the result as a **new** `Picture` document (new file, new three-word phrase) with `aiInstruction` set to the prompt and `originalPhrase` set back to the source picture, exactly like the camera's own AI-edited uploads. The viewer switches to show the new picture once it's ready. Requires `GOOGLE_API_KEY` in `.env`, and requires the source image file to actually be present in `public/pictures/` on this server (won't work against a picture whose file lives only on the production server — see "Testing locally" above).
- Backed by a small JSON API under `/manage/api/...` (`pages/manage.js`), used by `public/manage.js` on the page itself — not intended for external/device clients.

There's deliberately no login link on the homepage — the only way in is knowing to go to `/manage`.
