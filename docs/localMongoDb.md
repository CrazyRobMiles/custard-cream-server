# Running MongoDB locally on the Raspberry Pi

This describes replacing the remote MongoDB Atlas cluster (see [atlasMongoDb.md](atlasMongoDb.md)) with a MongoDB instance running in Docker on the same Raspberry Pi as the server, so database queries never leave the house. Measured directly against the Atlas cluster this server currently uses, every query — regardless of how simple — costs around 300ms in network round-trip alone; running the database on the same machine removes that entirely.

Docker is used rather than a native `apt install mongodb`, because MongoDB's official package repo doesn't publish Debian-arm64 builds (only Ubuntu and a handful of other distros get arm64 support) — Raspberry Pi OS is Debian-based, so the native install path is a dead end here. Docker sidesteps that: the official `mongo` image ships a proper arm64 build that runs on Raspberry Pi OS without caring what host distro it's on.

## Before you start

**Check the Pi can actually run modern MongoDB.** MongoDB 5.0 and later require ARM CPUs with the ARMv8.2-A instruction set. A Raspberry Pi 4 (Cortex-A72, ARMv8.0-A) does **not** have this and will crash the `mongod` process with an "Illegal instruction" error the moment it starts — this is a widely reported issue, not a misconfiguration. A Raspberry Pi 5 (Cortex-A76) does support it and is what this guide assumes. Check your model:

```bash
cat /proc/device-tree/model
uname -m   # should print aarch64 (64-bit) - if it prints armv7l, the OS itself is 32-bit and needs reinstalling as 64-bit first
```

If this is a Pi 4 or older, either move this role to a Pi 5 (or any other 64-bit ARMv8.2+ / x86_64 machine on your network), or stop here and keep using Atlas — there isn't a good workaround short of an end-of-life, unpatched MongoDB 4.4.

**Know what this does to shared accounts with box-server.** [configuration.md](configuration.md) notes this server is designed to share its Atlas cluster's `users` collection with [box-server](https://github.com/CrazyRobMiles/box-server), so a login works on both sites. Migrating this server's database to a local, LAN-only instance splits that apart — box-server won't be able to reach it, so from that point on, account changes made through one app won't be seen by the other. If you want the shared login to keep working, box-server would need to point at this same local instance too (only possible if it also runs on your home network), or you keep the two databases in sync some other way. This guide doesn't address that — it's worth deciding before you migrate the real data in Part 2.

## Part 1: Install and run MongoDB

### 1. Install Docker Engine

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

Log out and back in (or `newgrp docker`) so your shell picks up the new group membership, then confirm it works without `sudo`:

```bash
docker --version
docker compose version
docker run hello-world
```

`get-docker.sh` installs the Compose plugin (`docker compose`) as well as the engine, and enables Docker to start on boot — nothing further needed there.

### 2. Prepare persistent storage on the external SSD

Find where the SSD is mounted:

```bash
lsblk
df -h
```

Create a directory for MongoDB's data files there (substitute the actual mount point — the rest of this guide assumes `/mnt/ssd`):

```bash
sudo mkdir -p /mnt/ssd/mongodb-data
sudo chown $USER:$USER /mnt/ssd/mongodb-data
```

Keeping the data on the SSD rather than the boot SD card matters both for performance and for the SD card's write-endurance.

### 3. Define the MongoDB service

```bash
mkdir -p ~/mongodb
nano ~/mongodb/docker-compose.yml
```

```yaml
services:
  mongodb:
    image: mongo:7.0
    container_name: custard-cream-mongo
    restart: unless-stopped
    ports:
      - "127.0.0.1:27017:27017"
    environment:
      MONGO_INITDB_ROOT_USERNAME: ccsAdmin
      MONGO_INITDB_ROOT_PASSWORD: <choose-a-strong-password>
    volumes:
      - /mnt/ssd/mongodb-data:/data/db
    ulimits:
      nofile:
        soft: 64000
        hard: 64000
```

Three things worth noting:

- `127.0.0.1:27017:27017` binds the port to the Pi's loopback interface only — nothing elsewhere on your home network can connect, only processes on this Pi (which is all that needs to). Change this if you later want another machine on the LAN to reach it directly.
- Pick a real password for `MONGO_INITDB_ROOT_PASSWORD` and keep it somewhere safe (e.g. a password manager) — you'll need it again below.
- `ulimits` raises the container's open-file limit to the level MongoDB recommends. Docker's default is lower, which MongoDB complains about at startup (see "Startup warnings" below). A database this size won't actually hit the default limit, but raising it costs nothing and silences the warning. If you add this to an already-running setup, run `docker compose up -d` again to recreate the container — the data lives on the SSD, so nothing is lost.

### 4. Start it and confirm it's healthy

```bash
cd ~/mongodb
docker compose up -d
docker compose logs -f mongodb
```

Watch for `Waiting for connections` in the log with no errors above it, then `Ctrl+C` to stop following (the container keeps running). If instead you see the container repeatedly restarting with an `Illegal instruction` message, that's the ARMv8.2-A issue from "Before you start" above — this Pi's CPU can't run this MongoDB build.

Confirm you can connect:

```bash
docker exec -it custard-cream-mongo mongosh --username ccsAdmin
```

Enter the password when prompted; a `test>` prompt means it's working. Type `exit` to leave.

#### Startup warnings

Before the prompt, `mongosh` prints a telemetry notice and a block headed "The server generated these startup warnings when booting". These are warnings, not errors — if you reach the `test>` prompt, the server is working. On a Pi you're likely to see:

- **Telemetry notice** — `mongosh` sends anonymous usage data to MongoDB. Run `disableTelemetry()` once at the prompt to turn it off.
- **"Using the XFS filesystem is strongly recommended with the WiredTiger storage engine"** — the SSD is almost certainly formatted as ext4. XFS performs a little better under heavy write load, but at this server's scale it makes no practical difference. Safe to ignore; reformatting the SSD isn't worth it.
- **"Soft rlimits for open file descriptors too low"** — Docker's default open-file limit is below what MongoDB wants. The `ulimits` section in the compose file in step 3 fixes this; if you still see it, the container was created before that section was added — run `docker compose up -d` to recreate it.
- **"Failed to read file"** — the useful detail is in the full log entry, which `mongosh` truncates. See it with:

  ```bash
  docker compose logs mongodb | grep -i "failed to read"
  ```

  If the file it names is under `/sys/kernel/mm/` or `/proc/sys/vm/`, MongoDB is checking a kernel memory setting (such as transparent huge pages) that the Raspberry Pi kernel doesn't expose — harmless, ignore it. If it names anything under `/data/db`, that's the data directory on the SSD and is worth investigating: check the directory exists and is owned by the right user (step 2).

### 5. Create a database user for the app

MongoDB has its own user accounts, separate from anything in the app. Each program that connects to the database has to log in as one of them, and what it's allowed to do depends on which account it uses. This step creates the account the custard cream server will log in as.

At this point MongoDB has exactly one account:

- **`ccsAdmin`** — the root (administrator) account. You didn't create it by hand: the official `mongo` image created it automatically the first time the container started, from the `MONGO_INITDB_ROOT_USERNAME` and `MONGO_INITDB_ROOT_PASSWORD` values in `docker-compose.yml` (step 3). It's stored in MongoDB's built-in `admin` database and can do anything to every database on the server, including creating and deleting users. That makes it the right account for setting things up and for maintenance, but the wrong one for the app to use every day — if the server's `.env` were ever exposed, or a bug in the app ran the wrong query, root access would put every database on this MongoDB at risk.

This step uses `ccsAdmin` to create one more account in MongoDB:

- **`custardCreamApp`** — the account the custard cream server uses, and the only one whose username and password go in `.env` (step 7). It's given the `readWrite` role on the `custardcream` database only: it can read, add, change and delete documents there, but it can't touch any other database, manage users, or change server settings. That's everything the app needs and no more.

After this step there are two MongoDB accounts: `ccsAdmin` for you, when administering the database, and `custardCreamApp` for the server.

These accounts belong to MongoDB, not to the Pi. MongoDB stores them inside its own data, in a system collection in the `admin` database, which on this setup means inside the data files on the SSD. They have nothing to do with the Pi's Linux accounts: `ccsAdmin` can't log in to the Pi, and your Pi login can't connect to MongoDB. Because they're part of the data, whether they come along when the database moves somewhere else depends on how it's moved:

- **Copying the data directory** (`/mnt/ssd/mongodb-data`) to another machine running the same MongoDB version — the accounts and their passwords come with it unchanged.
- **`mongodump`/`mongorestore` of a single database** (with `--db`, as Part 2 does) — the accounts are left behind unless you add `--dumpDbUsersAndRoles` to the dump and `--restoreDbUsersAndRoles` to the restore. A dump without `--db` includes the `admin` database, and the accounts with it.
- **Moving to MongoDB Atlas** — the accounts don't transfer. Atlas manages database accounts through its dashboard (**Database Access**), so they have to be created again there.

Part 2 is an example of the second case running the other way: the dump from Atlas doesn't bring Atlas's database accounts across, which is why this step creates `custardCreamApp` locally.

Don't confuse these with the app's own logins. The accounts people use to sign in to the website — including the camera account that `checkForCameraUser()` creates — are just documents in the app's `users` collection, inside the `custardcream` database. MongoDB knows nothing about them, and they can't be used to connect to MongoDB. Nothing in this step creates or changes them; Part 2 brings the existing ones across from Atlas.

Log in as `ccsAdmin` (enter the root password from step 3 when prompted):

```bash
docker exec -it custard-cream-mongo mongosh --username ccsAdmin
```

Then switch to the `custardcream` database and create the app account in it, choosing a new password (not the root one):

```javascript
use custardcream
db.createUser({
  user: "custardCreamApp",
  pwd: "<choose-a-different-strong-password>",
  roles: [{ role: "readWrite", db: "custardcream" }]
})
exit
```

(`custardcream` here is just this database's name — anything works, it's created automatically on first use. Use the same name in Part 2 when restoring the migrated data into it, so the app finds it in the right place.)

Because the `use custardcream` line came before `createUser`, the user is stored in the `custardcream` database rather than `admin`. That's the database MongoDB checks its password against, so every login as this user has to name `custardcream` as its authentication database — the check in step 6 and the connection string in step 7 both do.

### 6. Check the app user can use the database

Before pointing the server at it, confirm from the console that the new user can log in and read and write `custardcream`, logging in the same way the server will:

```bash
docker exec -it custard-cream-mongo mongosh --username custardCreamApp --authenticationDatabase custardcream custardcream
```

Enter the app user's password (the one from step 5, not the root password). The prompt should read `custardcream>`. Then run:

```javascript
db.runCommand({ connectionStatus: 1 }).authInfo
db.connectionCheck.insertOne({ checkedAt: new Date() })
db.connectionCheck.find()
db.connectionCheck.drop()
show collections
exit
```

What to expect:

- `authInfo` lists `custardCreamApp` under `authenticatedUsers`, with `readWrite` on `custardcream` under `authenticatedUserRoles`.
- `insertOne` returns `acknowledged: true`, `find` shows the document you just inserted, and `drop` returns `true` — so the user can write, read and delete.
- `show collections` prints nothing on a fresh install (the test collection has just been dropped). After the Part 2 migration it lists `users` and `pictures`.

If login fails with `Authentication failed`, check the password, and check that `--authenticationDatabase` names the database you were `use`-ing when you ran `createUser` in step 5. If login works but `insertOne` fails with `not authorized`, the user's `roles` don't name this database — log in as `ccsAdmin` and fix it with `db.getSiblingDB("custardcream").grantRolesToUser("custardCreamApp", [{ role: "readWrite", db: "custardcream" }])`.

### 7. Point the server at it

In the server's `.env` (see [configuration.md](configuration.md)):

```
DATABASE_URL=mongodb://custardCreamApp:<password>@localhost:27017/custardcream
```

No `authSource` is needed: MongoDB uses the database named in the path (`custardcream`) as the authentication database by default, which is where step 5 created the user. Adding `?authSource=admin` here would make the login fail.

Restart the server and check its log for `Database connected`:

```bash
npm start
```

At this point the database is empty (or has whatever `checkForCameraUser()` created on this fresh start) — Part 2 below covers bringing the real data across.

## Part 2: Migrating the data from Atlas to local

Both steps below run `mongodump`/`mongorestore` inside temporary, throwaway containers built from the same `mongo:7.0` image already proven to work in Part 1 — this avoids needing to separately install MongoDB's command-line tools (which have the same Debian-arm64 packaging gap as the server itself).

### 1. Allow the Pi to reach Atlas

In the Atlas dashboard, under **Network Access**, confirm the Pi's public IP address (or `0.0.0.0/0`, temporarily, if the Pi's IP isn't static) is on the allow-list — `mongodump` will hang or time out otherwise. Remove the temporary entry again once the migration is done, if you added one just for this.

### 2. Dump the Atlas database

```bash
mkdir -p ~/mongo-migration
```

```bash
docker run --rm -v ~/mongo-migration:/dump mongo:7.0 \
  mongodump --uri="<your Atlas DATABASE_URL from .env>" --db=<dbname> --out=/dump
```

Replace `<dbname>` with the database name from your current production `.env`'s `DATABASE_URL` — it's the path segment right after the host, before the `?` (e.g. `mongodb+srv://user:pass@cluster0.example.mongodb.net/dbUser?...` → `dbUser`). Leaving out `--db` would dump every database that connection's user can see, which is more than you need.

Check it worked:

```bash
ls -la ~/mongo-migration/<dbname>
```

You should see `.bson` and `.metadata.json` files for `users` and `pictures` (and `picturebackups`, if `scripts/backupPictures.js` has ever been run against this data).

### 3. Restore into the local MongoDB

`--network container:custard-cream-mongo` puts this throwaway container on the same network namespace as the running MongoDB container, so it can reach it at `localhost:27017` exactly as the app does:

```bash
docker run --rm -v ~/mongo-migration:/dump --network container:custard-cream-mongo mongo:7.0 \
  mongorestore --uri="mongodb://ccsAdmin:<root-password>@localhost:27017/?authSource=admin" \
  --nsFrom="<dbname>.*" --nsTo="custardcream.*" \
  /dump
```

`--nsFrom`/`--nsTo` rename the database on the way in from whatever it was called on Atlas to `custardcream` (matching the name the app user was scoped to in Part 1, step 5) — drop both flags if you'd rather keep the original name, just make sure it matches the database name in `DATABASE_URL`.

### 4. Verify the data landed correctly

```bash
docker exec -it custard-cream-mongo mongosh --username ccsAdmin
```

```javascript
use custardcream
show collections
db.pictures.countDocuments()
db.users.countDocuments()
```

Compare the counts against Atlas (visible in the Atlas dashboard's collection view, or by running the same two `countDocuments()` calls against the Atlas connection string from any machine that can still reach it).

### 5. Switch the app over and check pictures actually load

If `.env`'s `DATABASE_URL` isn't already set as in Part 1 step 7, set it now, then restart the server and check a few real pages: `/`, `/random`, and a specific picture's `/pictures/<phrase>` URL for a phrase you know exists in the migrated data. `/manage` (which needs a login) is worth checking too, since that's the page the tag-filtering performance issue was originally about.

### 6. Decide what to do with Atlas afterwards

Nothing here deletes anything from Atlas — it's untouched and still has the full data as a backup. Once you're confident the local copy is working, you can leave the Atlas cluster idle as a backup, keep using it for box-server if that still needs the shared accounts (see "Before you start" above), or downsize/delete it if you're fully done with it.
