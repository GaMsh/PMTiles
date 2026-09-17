import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.9.0/dist/maplibre-gl.mjs';
import { Protocol } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm';
import { layers, namedFlavor } from 'https://cdn.jsdelivr.net/npm/@protomaps/basemaps@5.7.2/+esm';
import { PMTILES_VERSION } from './config.js';

const el = document.getElementById('map');
if (!el) {
    throw new Error('Карта не инициализирована');
}

maplibregl.setWorkerUrl('https://cdn.jsdelivr.net/npm/maplibre-gl@6.9.0/dist/maplibre-gl-worker.mjs');

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const localHost = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
const proxyPath = el.dataset.devProxy;
const pmtilesUrl = localHost && proxyPath
    ? `pmtiles://${location.origin}${proxyPath}`
    : el.dataset.pmtilesUrl;

const center = (el.dataset.center || '99.0,61.5').split(',').map(Number);
const zoom = Number(el.dataset.zoom || '3');

const map = new maplibregl.Map({
    container: el,
    style: {
        version: 8,
        glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
        sprite: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
        sources: {
            protomaps: {
                type: 'vector',
                url: pmtilesUrl,
                attribution:
                    '<a href="https://protomaps.com" rel="noreferrer">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" rel="noreferrer">OpenStreetMap</a> · <a href="https://pmtiles.io" rel="noreferrer">PMTiles</a>',
            },
        },
        layers: layers('protomaps', namedFlavor('light'), { lang: 'ru' }),
    },
    center,
    zoom,
    minZoom: 2,
    maxZoom: 18,
    hash: 'map',
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
map.addControl(new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
}), 'top-right');

map.once('load', () => {
    el.dataset.ready = PMTILES_VERSION;
});
