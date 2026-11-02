# custard-cream-server

An image server for the [custard cream camera](https://github.com/CrazyRobMiles/custard-cream-camera) — a networked Raspberry Pi camera that can publish photos to Flickr, Bluesky, or here.

The server accepts picture uploads from an authenticated camera, gives each one a memorable three-word address (e.g. `oak-larch-feather`), and lets anyone with that link (or who types the words in) view the picture. Every picture is eligible to show up in the random-view gallery — consent for publishing happens at capture time, when the camera operator chooses to publish. No login is ever needed just to look at pictures; posting a picture always requires one. Picture files are stored on disk under random GUID names, unrelated to their three-word phrase, so the file only becomes discoverable via a database lookup — not by browsing the folder or guessing filenames.

It's built with Node.js/Express/EJS/MongoDB. It can share a MongoDB database and its user accounts with other applications, so one login works on all of them — the original deployment shares one with [box-server](https://github.com/CrazyRobMiles/box-server) ("Connected Little Boxes"), a separate project. box-server isn't needed to run this server; see [docs/atlasMongoDb.md](docs/atlasMongoDb.md#sharing-one-atlas-database-between-several-applications) for how the sharing works and how to set up something similar for your own applications. Data access is via [Mongoose](https://mongoosejs.com/), with `User` and `Picture` models defined in [schemas/](schemas/) — see [docs/configuration.md#database-mongoose--mongodb](docs/configuration.md#database-mongoose--mongodb) for install, connection string, and schema details.

## Choosing a database

The server needs a MongoDB database, which it finds through the `DATABASE_URL` setting in `.env` (copy `.env.example` to `.env` to start). There are two ways to provide one:

- **MongoDB Atlas (hosted, free tier available)** — MongoDB runs the database in the cloud. Nothing to install, it works from any machine with internet access, and the free tier is plenty for this server. Each database query has to go over the internet, so pages are slower to load. It's also the option to use if this server is to share a database and logins with other applications, such as box-server. Setup: **[docs/atlasMongoDb.md](docs/atlasMongoDb.md)**.

  ```
  DATABASE_URL=mongodb+srv://custardCreamApp:<password>@cluster0.abcde.mongodb.net/custardcream?retryWrites=true&w=majority&appName=Cluster0
  ```

  Copy the host name (`cluster0.abcde.mongodb.net`) from the Atlas dashboard's **Connect** option, and use the password of the database user you create in Atlas.

- **Local MongoDB on the Raspberry Pi** — MongoDB runs in Docker on the same Pi as the server, so queries never leave the machine and are much faster. Needs a Raspberry Pi 5 (or another 64-bit ARMv8.2+ / x86_64 machine), and you look after it yourself. Setup: **[docs/localMongoDb.md](docs/localMongoDb.md)**.

  ```
  DATABASE_URL=mongodb://custardCreamApp:<password>@localhost:27017/custardcream
  ```

  Use the password you chose when creating the `custardCreamApp` user in `mongosh`.

In both cases, `custardcream` after the last `/` is the name of the database the server uses, and `custardCreamApp` is a MongoDB database account, not a website login. If the password contains any of `@ : / ? # [ ] %`, those characters must be percent-encoded in the URL (for example `@` becomes `%40`). [docs/atlasMongoDb.md](docs/atlasMongoDb.md#atlas-or-local) has a side-by-side comparison of the two options.

## Documentation

- **[docs/usage.md](docs/usage.md)** — how to browse pictures, scan/follow a QR code or three-word link, and see the random gallery.
- **[docs/configuration.md](docs/configuration.md)** — installing dependencies, `.env` settings, **the MongoDB/Mongoose database (connection string, schemas)**, the camera account, running the server, and where picture files are stored.
- **[docs/atlasMongoDb.md](docs/atlasMongoDb.md)** — setting up a hosted MongoDB Atlas database, including what the free tier allows.
- **[docs/localMongoDb.md](docs/localMongoDb.md)** — running MongoDB in Docker on the Raspberry Pi, and migrating existing data from Atlas to it.
- **[docs/runningOnPi.md](docs/runningOnPi.md)** — running the server on a Raspberry Pi as a systemd service (starts at boot, restarts after crashes), and reaching it by name on the home network with mDNS/Avahi (`custardcream.local`).
- **[docs/cloudflared.md](docs/cloudflared.md)** — exposing a Pi-hosted server publicly at a real domain via Cloudflare Tunnel: getting a domain onto Cloudflare, DNS, and installing/running/maintaining `cloudflared` as a service.

## Project layout

```
schemas/     Mongoose models (User, Picture)
behaviours/  Middleware and helpers (auth, role checks, three-word phrase generator)
pages/       Express routes (login, logout, pictures, random)
views/       EJS templates
public/      Static files, including uploaded pictures in public/pictures/
```
