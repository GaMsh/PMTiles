# PMTiles

Статический сайт [pmtiles.ru](https://pmtiles.ru): полноэкранная карта и страница «О проекте».

Отечественное зеркало [pmtiles.io](https://pmtiles.io). Тайлы отдаёт локальный Caddy с `cdn.pmtiles.ru` по `/tiles/`.

## Docker

Контейнер `pmtiles_ru` в сети `web_network`, HTTP/2 cleartext на `:80` — как FrankenPHP у GaMiKo / ews / GaMsh. Снаружи его забирает [CaddyProxy](../CaddyProxy).

```bash
docker compose up -d --build
```

Прямой заход: http://127.0.0.1:8091/

Через прокси: https://pmtiles.ru/ (нужен запущенный `caddy_main_proxy`).

Прод без bind-mount:

```bash
docker compose -f compose.yaml -f compose.prod.yaml up -d --build
```
