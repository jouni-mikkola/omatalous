section: Maintenance
- Remote access through Cloudflare is gone. Reach the app on the home network, through a VPN or on your own domain with Caddy.
upgrade: The saved Cloudflare token and the old remote access settings are deleted on the first start. Remove a leftover `cloudflared` container with `docker compose up -d --remove-orphans`.
