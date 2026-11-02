# Using a MongoDB Atlas database

This describes setting up a database for the server on [MongoDB Atlas](https://www.mongodb.com/atlas), MongoDB's hosted cloud service. Atlas is the simplest way to get a database: there's nothing to install or maintain, and it works the same whether the server runs on a Raspberry Pi, a laptop or a cloud host. The alternative is running MongoDB yourself on the same Pi as the server — see [localMongoDb.md](localMongoDb.md) for that, and "Atlas or local?" at the end of this page for how to choose.

## What the free tier gives you

Atlas has a permanently free cluster tier, called **Free** in the Atlas dashboard (it used to be called **M0**, and you'll still see that name in older guides and forum posts). It needs no payment card. Its main limits, from MongoDB's [pricing page](https://www.mongodb.com/pricing), [service limits](https://www.mongodb.com/docs/atlas/reference/atlas-limits/) and [Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/), are:

| Limit | Free tier |
| --- | --- |
| Storage | 512 MB, including indexes. This is a hard limit — writes fail once it's reached, and the only way to get more is to move to a paid cluster. |
| Operations | Up to 100 reads and writes per second. Above that, Atlas slows the connection down rather than refusing requests. |
| Connections | Up to 500 at once. |
| Number of free clusters | One per Atlas project. You can create more projects if you need more than one free cluster. |
| Inactivity | A free cluster with no connections for 30 days is paused automatically. Atlas emails a warning seven days beforehand, and you can resume it from the dashboard. |
| Backups | No automated backups. Take your own with `mongodump` (see [localMongoDb.md](localMongoDb.md), Part 2, step 2, for the command). |
| Hardware | Shared with other free users, so response times vary. |

These limits change from time to time, so check the pages linked above if anything here looks out of date.

**How that fits this server:** the free tier is plenty for it. The database only holds small records — one per picture (its three-word phrase, filename, tags and so on) and one per user account. The picture files themselves are stored on the server's own disk, not in the database (see [configuration.md](configuration.md#where-pictures-are-stored)), so even tens of thousands of pictures use only a small part of the 512 MB. A server that's running normally connects far more often than once a month, so the inactivity pause only affects a test cluster you've left unused.

The cost that matters more is speed. Every database query has to travel from the server to the Atlas data centre and back. Measured against the Atlas cluster this server uses, that adds around 300ms to every query, however simple — which is what prompted the local option in [localMongoDb.md](localMongoDb.md). Picking the Atlas region closest to where the server runs (step 2 below) keeps this as low as possible.

## Sharing one Atlas database between several applications

A single free cluster has room for far more than this server needs, so it can also hold the data for other small applications — and those applications can share a single set of user accounts, so one login works on all of them. The original deployment of this server is set up exactly that way, and you may want to do the same if you run several applications that each need a small database.

### How the original deployment is arranged

The original custard cream server shares its Atlas database with [box-server](https://github.com/CrazyRobMiles/box-server), the server behind "Connected Little Boxes", a separate project by the same author. box-server is not part of this project and this server doesn't need it: it's simply another application using the same database. The arrangement is:

- **One Atlas cluster, one database** — both applications' `DATABASE_URL` settings point at the same database (called `connected_little_boxes`, as `.env.example` shows).
- **One shared collection: `users`** — this holds every user account, and both applications read and write it. An account created through either application can log in to both.
- **Separate collections for everything else** — each application keeps its own data in collections with its own names. This server's are `pictures` (and `picturebackups`, if `scripts/backupPictures.js` has been run); box-server's are its own. Neither application touches the other's collections.

### Doing the same with your own applications

The pattern works for any set of applications that each need a little data and a common set of users. For it to work, every application sharing the database must agree on these things:

- **The `users` documents.** Every application must read and write user documents with the same fields and meanings — this server's are listed under `schemas/user.js` in [configuration.md](configuration.md#schemas). If one application adds a required field the others don't fill in, or stores passwords a different way (this server uses bcrypt hashes), accounts created by one application won't work in another. This includes the `role` field: each application decides for itself what each role is allowed to do, so check that a role means what you expect everywhere — a user who is `"admin"` in one application is `"admin"` in all of them.
- **Collection names.** Each application's own collections need names no other application uses. If two applications both had a `pictures` collection, they'd read and change each other's data. This server's `PICTURES_COLLECTION` setting (see [configuration.md](configuration.md#env-settings)) can rename its collection if there's a clash.
- **The login secret.** This server signs login tokens with `ACTIVE_TOKEN_SECRET`. Each application only checks tokens it issued itself, so the secrets don't have to match, but giving every sharing application the same value avoids surprises if that ever changes (see [configuration.md](configuration.md#env-settings)).

If your applications don't need shared logins, there's a simpler version: keep them all in one cluster, but give each its own database by using a different database name in each `DATABASE_URL` (the part after the host name — see step 5). They then share the cluster's limits but none of their data, and none of the points above apply.

### What sharing costs

Everything in the cluster shares the free tier's limits: the 512 MB of storage, the 100 operations per second and the 500 connections are totals for all the applications together, not each. For a handful of small applications that's rarely a problem, but check the cluster's usage in the Atlas dashboard as you add more. Any application that's running keeps the cluster active, so the 30-day inactivity pause is less likely to catch the others.

Shared logins also tie the applications to the same database. Moving one of them to a local MongoDB, for example, splits it from the others' accounts — see "Before you start" in [localMongoDb.md](localMongoDb.md).

## Before you start

**Decide whether this server will share a database with other applications** (see above). If you already have an Atlas database that you want this server to share — the original deployment shares box-server's — don't create anything new: go to step 3 to give this server its own database user, if it needs one, then use that database's connection string in step 5. Otherwise, carry on from step 1 to create a database for this server.

## Setting up the database

The Atlas dashboard is rearranged every so often, so menu names and positions may not exactly match what's described here, but the steps themselves stay the same.

### 1. Create an Atlas account and project

Sign up at [mongodb.com/atlas](https://www.mongodb.com/atlas). Atlas organises everything into **projects**; the sign-up process creates a first one for you, or you can create one named, for example, `custard-cream`.

### 2. Create a free cluster

In the project, create a new cluster and choose the **Free** tier. Then:

- **Provider and region** — pick the region geographically closest to where the server will run. This has the biggest effect on how fast pages load (see above). Any of the three cloud providers is fine.
- **Name** — the default (`Cluster0`) is fine.

Creating the cluster takes a few minutes. Atlas may offer to create a database user and add your current IP address while you wait; you can do that there, or follow steps 3 and 4 instead, which explain the choices.

### 3. Create a database user for the server

As with a local MongoDB (see [localMongoDb.md](localMongoDb.md), Part 1, step 5), the database has its own user accounts, separate from the website's logins. The server needs one to connect with. Atlas manages these accounts in the dashboard rather than through `mongosh`: go to **Database Access** (under **Security**) and add a new database user:

- **Authentication method** — password.
- **Username** — for example `custardCreamApp`.
- **Password** — use **Autogenerate Secure Password** and copy it somewhere safe, such as a password manager. A generated password contains only letters and digits, which avoids a problem in step 5: characters such as `@`, `:`, `/`, `?` or `%` in a password break the connection string unless they're encoded.
- **Privileges** — use **Specific Privileges** and grant `readWrite` on the database the server will use: `custardcream` for a database of its own, or the shared database's name if it's sharing one (see "Sharing one Atlas database between several applications" above). That's everything the server needs. **Read and write to any database** also works and is quicker to set up, but on a cluster holding other applications' databases it would let this server change theirs too.

Don't give the server an **Atlas admin** account: it can do far more than the server needs.

The website's own logins — including the camera account — are not created here. They're documents in the database's `users` collection, and the server creates the camera account itself the first time it starts (see [configuration.md](configuration.md#the-camera-account)).

### 4. Allow the server's machine to connect

Atlas refuses connections from any address not on the project's IP access list. Go to **Network Access** (under **Security**) and add the public IP address of the machine the server runs on.

- **Server at home, such as on a Pi** — add your home's public IP address. From that machine, `curl -4 ifconfig.me` prints it. Most home broadband addresses change from time to time; when that happens the server will fail to connect at startup, and you'll need to add the new address.
- **Server on a cloud host whose address changes** — you may have to allow `0.0.0.0/0` (anywhere). The database is then protected only by the user's password, so make sure it's a strong, generated one.
- **Your own computer, for testing** — add its address too, if it's different from the server's.

### 5. Get the connection string and set `.env`

On the cluster, choose **Connect**, then **Drivers**, and copy the connection string. It looks like this:

```
mongodb+srv://custardCreamApp:<db_password>@cluster0.abcde.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
```

Make two changes before putting it in `.env`:

1. Replace `<db_password>` with the password from step 3 (including removing the `<` and `>`).
2. Add the database name after the `/` that follows the host name. The server will create the database on first use:

```
DATABASE_URL=mongodb+srv://custardCreamApp:<password>@cluster0.abcde.mongodb.net/custardcream?retryWrites=true&w=majority&appName=Cluster0
```

If you leave out the database name, everything goes into a database called `test`. That works, but it's easy to confuse later.

No `authSource` setting is needed: for a `mongodb+srv://` address, Atlas supplies the right one automatically.

If you chose your own password and it contains any of `@ : / ? # [ ] %`, each of those characters has to be replaced by its percent-encoded form in the connection string (for example `@` becomes `%40`) — or change the password to a generated one.

### 6. Start the server and check it connects

```bash
npm start
```

Look for `Database connected` in the log, followed by `Server listening on: <port>`. On first start against a new, empty database, the server also creates the camera account from `CAMERA_ACCOUNT_EMAIL` and `CAMERA_ACCOUNT_PASSWORD` in `.env`.

If it fails to connect instead:

- **The startup hangs, then times out (`Server selection timed out`)** — usually the machine's IP address isn't on the access list (step 4). Check the address, especially if your broadband address may have changed.
- **`bad auth : authentication failed`** — the username or password in `DATABASE_URL` is wrong, or the password contains a character that needs encoding (step 5).
- **The cluster was paused** — after 30 days with no connections. Resume it from the Atlas dashboard.

In the Atlas dashboard, **Browse Collections** on the cluster now shows the `custardcream` database, with a `users` collection holding the camera account. A `pictures` collection appears after the first picture is uploaded.

## Atlas or local?

| | Atlas (this page) | Local ([localMongoDb.md](localMongoDb.md)) |
| --- | --- | --- |
| Cost | Free, within the limits above | Free; uses the Pi's own disk |
| Setup and upkeep | Dashboard only; MongoDB handles updates | Docker and MongoDB on the Pi; you install updates |
| Hardware | Anything that can reach the internet | Needs a Raspberry Pi 5 (or other ARMv8.2+ / x86_64 machine) |
| Speed | Around 300ms per query from the Pi used here, depending on region | Near-instant — no network involved |
| Sharing a database and logins with other applications | Yes, from anywhere (see "Sharing one Atlas database between several applications") | Only with applications running on the same network |
| Backups | None on the free tier; use `mongodump` | Back up the data directory or use `mongodump` |

Either way, the server only needs `DATABASE_URL` in `.env` to point at the right place, so you can start on Atlas and move to local later (or back) by migrating the data and changing that one line. [localMongoDb.md](localMongoDb.md), Part 2, covers moving from Atlas to local.
