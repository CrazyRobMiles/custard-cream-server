# Exposing the server publicly with Cloudflare Tunnel (`cloudflared`)

This describes how to make a server running on a Raspberry Pi (or any machine on a home/local network with no public IP or open ports) reachable at a real domain name, using [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/). The Pi makes an outbound connection to Cloudflare — there's no port forwarding, no static IP, and no inbound firewall rule needed on the router.

## 1. Get a domain name onto Cloudflare

Cloudflare Tunnel requires the domain's DNS to be managed by Cloudflare (it works by creating a DNS record for you, so it needs to own the zone).

- If you don't have a domain yet, you can register one directly through Cloudflare Registrar (Dashboard → **Domain Registration** → **Register Domain**) — Cloudflare sells at cost, no markup.
- If you already own a domain elsewhere (e.g. Namecheap, GoDaddy), instead:
  1. In the Cloudflare dashboard, **Add a Site** and enter the domain.
  2. Cloudflare scans existing DNS records and shows you the nameservers it wants you to use (e.g. `aida.ns.cloudflare.com`, `theo.ns.cloudflare.com`).
  3. Log in to your domain registrar and change the domain's nameservers to the two Cloudflare gives you. This is the only change needed at the registrar — everything else happens in Cloudflare.
  4. Wait for the nameserver change to propagate (usually minutes, occasionally up to 24h); Cloudflare emails you once the zone is active.

You don't need to point the whole domain at this server — a subdomain (e.g. `photos.example.com`) works fine and is usually what you want, so the tunnel only owns one DNS record.

## 2. DNS settings for the tunnel

You don't create the DNS record by hand in the dashboard — `cloudflared` does it for you once the tunnel exists (see step 4 below), by running:

```
cloudflared tunnel route dns <tunnel-name> photos.example.com
```

This creates a `CNAME` record for `photos.example.com` pointing at `<tunnel-id>.cfargotunnel.com`, proxied through Cloudflare (orange-cloud on). Because it's proxied, Cloudflare terminates TLS for you — the public site is `https://photos.example.com` automatically, with no certificate to manage on the Pi. If you ever want to check or edit it manually, it'll show up under **DNS → Records** for the zone as a proxied CNAME.

## 3. Install `cloudflared` on the Pi

Raspberry Pi OS is Debian-based, so use Cloudflare's `.deb` package (arm64 for a 64-bit Pi OS, arm for 32-bit):

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

(Use `cloudflared-linux-arm.deb` instead if running 32-bit Raspberry Pi OS — check with `uname -m`: `aarch64` = arm64, `armv7l` = arm.)

## 4. Authenticate and create the tunnel

```bash
cloudflared tunnel login
```

This opens a browser (or gives you a URL to open elsewhere) to authorize `cloudflared` against your Cloudflare account and the zone you want to use; it stores a certificate at `~/.cloudflared/cert.pem`.

```bash
cloudflared tunnel create custard-cream-server
```

This creates the tunnel and a credentials file (a JSON file containing the tunnel's private key) at `~/.cloudflared/<tunnel-id>.json` — treat this like a secret, it's what lets `cloudflared` authenticate as this tunnel.

Route the DNS record to it (see step 2):

```bash
cloudflared tunnel route dns custard-cream-server photos.example.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: custard-cream-server
credentials-file: /home/pi/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: photos.example.com
    service: http://localhost:3100
  - service: http_status:404
```

Use whatever port the server's `PORT` (or `HOST_ADDRESS`) is actually listening on — see [configuration.md](configuration.md). The final `http_status:404` catch-all is required by `cloudflared` as the default rule for any hostname not explicitly listed.

Test it before installing as a service:

```bash
cloudflared tunnel run custard-cream-server
```

With the Node server also running locally, `https://photos.example.com` should now reach it. `Ctrl+C` stops this foreground run.

## 5. Run it as a service (start automatically, survive reboots)

```bash
sudo cloudflared service install
```

This installs `cloudflared` as a systemd service using the config at `/etc/cloudflared/config.yml` — copy your `~/.cloudflared/config.yml` and credentials file there, or edit `/etc/cloudflared/config.yml` directly, so it's readable by the service (running as root).

```bash
sudo systemctl enable cloudflared    # start on boot
sudo systemctl start cloudflared     # start now
sudo systemctl status cloudflared    # check it's running
```

The Node server itself should also be set up to survive reboots/crashes independently of the tunnel (e.g. via `pm2`, a systemd service of its own, or similar) — the tunnel only forwards traffic, it doesn't keep the app alive.

## 6. Maintaining the tunnel

- **Logs**: `journalctl -u cloudflared -f` (follow live) or `sudo systemctl status cloudflared` for a summary of recent activity/errors.
- **Restart after config changes**: edit `/etc/cloudflared/config.yml`, then `sudo systemctl restart cloudflared`.
- **Update `cloudflared`**: re-download the latest `.deb` from the same release URL as step 3 and `sudo dpkg -i cloudflared.deb` again, then `sudo systemctl restart cloudflared`. Check the running version with `cloudflared --version`.
- **List/inspect tunnels**: `cloudflared tunnel list` (shows all tunnels on the account and their IDs), `cloudflared tunnel info custard-cream-server` (shows active connections).
- **Rotate credentials**: if the credentials file is ever compromised, delete the tunnel (`cloudflared tunnel delete custard-cream-server`) and recreate it (step 4) — this issues a new credentials file and you'll need to re-run `route dns` and update the service config.
- **Stop serving without deleting anything**: `sudo systemctl stop cloudflared` (traffic to the hostname will fail until it's started again; the DNS record and tunnel keep existing).
