FROM caddy:2.11

COPY caddy/Caddyfile /etc/caddy/Caddyfile
COPY public /srv

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
	CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1
