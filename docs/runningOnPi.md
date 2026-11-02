# Running the server on a Raspberry Pi

This covers two things that turn a server you start by hand into one that just works on a Pi:

- **Running it as a service**, so it starts by itself when the Pi boots and restarts if it ever crashes.
- **Finding it by name** on your home network, as `custardcream.local` (or whatever you call the Pi), instead of by an IP address that can change.

It assumes the server is already installed and runs correctly with `npm start` — see [configuration.md](configuration.md) — and that it lives in `~/custard-cream-server`. Adjust the paths if yours is elsewhere.

## Part 1: Running the server as a service

Raspberry Pi OS uses **systemd** to start and supervise background services — it's what already runs Docker and, if you use it, `cloudflared` ([cloudflared.md](cloudflared.md)). Giving the server a systemd service of its own means:

- it starts automatically at boot, without anyone logging in;
- if it stops with an error — for example because the database wasn't reachable yet — systemd waits a few seconds and starts it again;
- its log output is kept by the system, and can be read at any time.

### Two things to know first

**The server finds `.env` through its working folder.** It loads `.env` from whichever folder it's started in, so the service has to start it in `~/custard-cream-server`. The service file below does this with `WorkingDirectory`.

**Don't set `PORT` in the service file.** The server only reads `.env` at all when `PORT` isn't already set in its environment (or is `3000`) — that's how it tells it's not running on a hosting platform like Heroku. If the service file set `PORT`, every other setting in `.env`, including `DATABASE_URL`, would be ignored. Keep `PORT` and everything else in `.env`.

Also install the server's dependencies with plain `npm install`, not `npm install --omit=dev` or with `NODE_ENV=production` set. The package that reads `.env` (`dotenv`) is listed as a development dependency, so leaving those out would stop the server from starting.

### 1. Create the service file

If the server is running in a terminal, stop it first (`Ctrl+C`) — the service can't start while something else is using the port.

Run this as the user the server should run as (your normal login, not `root`). It writes the service file and fills in your username, home folder and the location of `node` automatically:

```bash
sudo tee /etc/systemd/system/custard-cream.service > /dev/null <<EOF
[Unit]
Description=Custard Cream Server
Wants=network-online.target
After=network-online.target docker.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOME/custard-cream-server
ExecStart=$(command -v node) server.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

Check what it wrote:

```bash
cat /etc/systemd/system/custard-cream.service
```

The `User`, `WorkingDirectory` and `ExecStart` lines should show your real username, home folder and something like `/usr/bin/node` — not `$USER` or an empty value. If `ExecStart` is just ` server.js`, Node.js isn't installed or isn't on your path; see [configuration.md](configuration.md#installing-nodejs-on-a-raspberry-pi).

What the settings do:

- **`Wants=network-online.target` and `After=network-online.target`** — wait until the Pi has a working network connection before starting, so the server can reach the database (and, for Atlas, look up its address).
- **`After=docker.service`** — if you use the local MongoDB in Docker ([localMongoDb.md](localMongoDb.md)), start after Docker. On a Pi without Docker this line does nothing.
- **`User`** — run as your user rather than `root`, so the server can write uploaded pictures into `public/pictures/` with the same ownership as the rest of the folder.
- **`Restart=on-failure` and `RestartSec=10`** — if the server exits with an error, start it again after 10 seconds. The server deliberately exits if it can't connect to the database at startup (`Failed to start services` in the log), so this also covers the database not being ready yet — after a reboot, MongoDB's container may still be starting when the server first tries. It keeps retrying until the database is there.
- **`WantedBy=multi-user.target`** — start as part of the normal boot.

### 2. Enable and start it

```bash
sudo systemctl daemon-reload                  # make systemd read the new file
sudo systemctl enable --now custard-cream     # start at every boot, and start it now
```

### 3. Check it's running

```bash
systemctl status custard-cream
```

Look for `active (running)` and, in the recent log lines underneath, `Database connected` and `Server listening on: <port>`. Then open the site in a browser to be sure.

If it shows `activating (auto-restart)` or `failed` instead, the log says why — see below. The most common causes are a wrong `DATABASE_URL`, the database not running, or the server not finding `.env` (check the `WorkingDirectory` line).

Finally, reboot the Pi (`sudo reboot`) and check the site comes back without you doing anything.

### Day-to-day use

| To | Run |
| --- | --- |
| See whether it's running, plus the last few log lines | `systemctl status custard-cream` |
| Follow the log live (`Ctrl+C` to stop following) | `journalctl -u custard-cream -f` |
| See the log since the last boot | `journalctl -u custard-cream -b` |
| Restart it — needed after editing `.env` | `sudo systemctl restart custard-cream` |
| Stop it until the next boot | `sudo systemctl stop custard-cream` |
| Stop it starting at boot | `sudo systemctl disable custard-cream` |

To run the server by hand for a while — for example `npm run devstart` while trying out changes — stop the service first, or the two will fight over the port (`EADDRINUSE` in the log). Start the service again when you're done.

**Updating the server:**

```bash
cd ~/custard-cream-server
git pull
npm install
sudo systemctl restart custard-cream
```

## Part 2: Finding the Pi by name with mDNS

Every device on your home network has an IP address, such as `192.168.1.42`, but home routers can hand out a different one after a restart, which breaks any link or setting that uses it. **mDNS** (multicast DNS) solves this: the Pi announces its own name on the local network, and other devices can reach it as `<hostname>.local` — for example `http://custardcream.local:3100/`.

Raspberry Pi OS does this out of the box with a program called **Avahi**. There's normally nothing to install.

### 1. Check it's working

On the Pi, see its current name and confirm Avahi is running:

```bash
hostname
systemctl status avahi-daemon
```

`avahi-daemon` should be `active (running)`. If it isn't installed, add it with `sudo apt install avahi-daemon`.

Then, from another computer on the same network, try the name (with the Pi's hostname in place of `custardcream`):

```bash
ping custardcream.local
```

and open `http://custardcream.local:3100/` (with your `PORT`) in a browser.

### 2. Give the Pi a sensible name

The name is the Pi's hostname, set when the SD card was prepared — often something generic like `raspberrypi`. To change it:

```bash
sudo raspi-config
```

Choose **System Options**, then **Hostname**, enter the new name (letters, digits and hyphens only, such as `custardcream`), and reboot when asked. `raspi-config` updates everything that needs to change; the new `.local` name works once the Pi is back up.

**Every Pi on the network needs a different name.** If you run a second copy of the system — for example a duplicate for testing — give it its own name, such as `custardcream-test`. If two Pis have the same name, Avahi renames one of them automatically (to `custardcream-2.local`, for example), and links that used the name may reach the wrong Pi.

### 3. Use the name in settings

Anywhere you'd otherwise type the Pi's IP address, use the `.local` name instead:

- **`HOST_ADDRESS` in `.env`** — the base of the picture links the server sends back to the camera, e.g. `HOST_ADDRESS=http://custardcream.local:3100/`. Only do this for a server used on your home network: a server published to the internet ([cloudflared.md](cloudflared.md)) should use its public address, such as `https://custardcream.cam/`, because `.local` names don't work outside the local network.
- **The camera** — point custard-cream-camera at `http://custardcream.local:3100/` (its `publish.custard_cream_server.base_url` setting) so it keeps finding the server if the Pi's IP address changes.

Restart the service after changing `.env` (`sudo systemctl restart custard-cream`).

### Limits of `.local` names

- **Same network only.** mDNS only works between devices on the same local network. It can't make the Pi reachable from the internet; that's what [cloudflared.md](cloudflared.md) is for.
- **Some networks block it.** Guest Wi-Fi networks, some mesh systems and most workplace or event networks block the traffic mDNS relies on. If `.local` names don't work, use the IP address — and consider asking your router to always give the Pi the same one (often called a *DHCP reservation*).
- **Device support.** macOS, iOS, Linux and current versions of Windows look up `.local` names without any setup. Some Android phones, especially older ones, can't — which matters if people will open picture links or scan QR codes on their phones.

### Optional: advertise the server as a web service

Avahi can also announce *what* the Pi offers, not just its name, so apps that browse the network for web servers list it by name. Nothing in this project needs it, and browsers don't use it, but if you'd like it, create `/etc/avahi/services/custard-cream.service` (with your `PORT` in place of `3100`):

```xml
<?xml version="1.0" standalone='no'?>
<!DOCTYPE service-group SYSTEM "avahi-service.dtd">
<service-group>
  <name replace-wildcards="yes">Custard Cream Server on %h</name>
  <service>
    <type>_http._tcp</type>
    <port>3100</port>
  </service>
</service-group>
```

Avahi notices the new file by itself within a few seconds. To check from another Linux machine with Avahi installed, run `avahi-browse -t _http._tcp` and look for "Custard Cream Server on …".
