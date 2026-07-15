# custard-cream-server

An image server for the [custard cream camera](https://github.com/CrazyRobMiles/custard-cream-camera) — a networked Raspberry Pi camera that can publish photos to Flickr, Bluesky, or here.

The server accepts picture uploads from an authenticated camera, gives each one a memorable three-word address (e.g. `oak-larch-feather`), and lets anyone with that link (or who types the words in) view the picture. Every picture is eligible to show up in the random-view gallery — consent for publishing happens at capture time, when the camera operator chooses to publish. No login is ever needed just to look at pictures; posting a picture always requires one. Picture files are stored on disk under random GUID names, unrelated to their three-word phrase, so the file only becomes discoverable via a database lookup — not by browsing the folder or guessing filenames.

It's built with Node.js/Express/EJS/MongoDB, structured to sit alongside [box-server](https://github.com/CrazyRobMiles/box-server) ("Connected Little Boxes") and share its database and user accounts.

## Documentation

- **[docs/usage.md](docs/usage.md)** — how to browse pictures, scan/follow a QR code or three-word link, and see the random gallery.
- **[docs/configuration.md](docs/configuration.md)** — installing dependencies, `.env` settings, the camera account, running the server, and where picture files are stored.

## Project layout

```
schemas/     Mongoose models (User, Picture)
behaviours/  Middleware and helpers (auth, role checks, three-word phrase generator)
pages/       Express routes (login, logout, pictures, random)
views/       EJS templates
public/      Static files, including uploaded pictures in public/pictures/
```
