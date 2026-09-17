import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.9.0/dist/maplibre-gl.mjs';
import { Protocol } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm';
import { layers, namedFlavor } from 'https://cdn.jsdelivr.net/npm/@protomaps/basemaps@5.7.2/+esm';
import { PMTILES_VERSION } from './config.js';

const KEEP_POI_KINDS = [
    'monument',
    'memorial',
    'museum',
    'artwork',
    'art',
    'attraction',
    'viewpoint',
    'square',
    'plaza',
];

const OSM_TYPES = {
    1: 'node',
    2: 'way',
    3: 'relation',
};

const POI_PINK = ['#EF56BA', '#F9EBFE'];

const el = document.getElementById('map');
if (!el) {
    throw new Error('Карта не инициализирована');
}

maplibregl.setWorkerUrl('https://cdn.jsdelivr.net/npm/maplibre-gl@6.9.0/dist/maplibre-gl-worker.mjs');

const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

const pmtilesUrl = el.dataset.pmtilesUrl
    || `pmtiles://${location.origin}/tiles/${PMTILES_VERSION}.pmtiles`;

const center = (el.dataset.center || '99.0,61.5').split(',').map(Number);
const zoom = Number(el.dataset.zoom || '3');

const flavor = namedFlavor('light');
const styleLayers = layers('protomaps', flavor, { lang: 'ru' }).map((layer) => (
    layer.id === 'pois' ? restylePois(layer) : layer
));

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
        layers: styleLayers,
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

window.pmtilesMap = map;

map.on('load', async () => {
    await addPoiIcons(map);
    if (map.getLayer('pois')) {
        map.setLayoutProperty('pois', 'icon-image', poiIconImage());
    }
    el.dataset.ready = PMTILES_VERSION;
});

map.on('click', (event) => {
    if (!map.getLayer('pois')) {
        return;
    }
    const features = map.queryRenderedFeatures(event.point, { layers: ['pois'] });
    if (!features.length) {
        return;
    }
    alert(osmTypeId(features[0]));
});

map.on('mousemove', (event) => {
    if (!map.getLayer('pois')) {
        return;
    }
    const hovering = map.queryRenderedFeatures(event.point, { layers: ['pois'] }).length > 0;
    map.getCanvas().style.cursor = hovering ? 'pointer' : '';
});

function restylePois(layer) {
    const next = {
        ...layer,
        layout: { ...(layer.layout || {}) },
        paint: { ...(layer.paint || {}) },
    };

    next.filter = [
        'all',
        ['in', ['get', 'kind'], ['literal', KEEP_POI_KINDS]],
        ['>=', ['zoom'], ['+', ['coalesce', ['get', 'min_zoom'], 14], -2]],
    ];
    next.layout['icon-optional'] = true;
    next.layout['text-optional'] = true;
    next.layout['icon-image'] = poiIconImage();
    next.layout['icon-size'] = 1;
    next.layout['icon-anchor'] = 'center';
    next.layout['text-anchor'] = 'top';
    next.layout['text-offset'] = [0, 0.7];
    delete next.layout['text-variable-anchor'];
    next.paint['text-color'] = POI_PINK[0];
    next.paint['text-halo-color'] = flavor.earth;
    next.paint['text-halo-width'] = 1;
    return next;
}

function poiIconImage() {
    return [
        'match',
        ['get', 'kind'],
        'monument', 'pm-icon-monument',
        'memorial', 'pm-icon-memorial',
        'museum', 'pm-icon-museum',
        ['artwork', 'art'], 'pm-icon-artwork',
        'attraction', 'pm-icon-attraction',
        'viewpoint', 'pm-icon-viewpoint',
        ['square', 'plaza'], 'pm-icon-square',
        'pm-icon-attraction',
    ];
}

function poiIconSvg(glyph) {
    const [stroke, fill] = POI_PINK;
    return `<svg width="19" height="19" viewBox="0 0 19 19" xmlns="http://www.w3.org/2000/svg">
        <rect x="0.7" y="0.7" width="17.6" height="17.6" rx="4.2" fill="${fill}" stroke="${stroke}" stroke-width="1.35"/>
        <g fill="none" stroke="${stroke}" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>
    </svg>`;
}

function addSvgIcon(mapInstance, id, svg) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            if (!mapInstance.hasImage(id)) {
                mapInstance.addImage(id, img);
            }
            resolve();
        };
        img.onerror = reject;
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
}

function addPoiIcons(mapInstance) {
    return Promise.all([
        addSvgIcon(mapInstance, 'pm-icon-monument', poiIconSvg(`
            <path d="M9.5 4.4 L11.5 13.6 H7.5 Z"/>
            <path d="M6.2 13.6 H12.8 M6.8 14.8 H12.2"/>
        `)),
        addSvgIcon(mapInstance, 'pm-icon-memorial', poiIconSvg(`
            <rect x="6.2" y="5.2" width="6.6" height="8.2" rx="0.6"/>
            <path d="M7.6 7.4 H11.4 M7.6 9.2 H11.4 M7.6 11 H10.4"/>
            <path d="M5.4 13.8 H13.6"/>
        `)),
        addSvgIcon(mapInstance, 'pm-icon-museum', poiIconSvg(`
            <path d="M4.6 8.2 L9.5 4.8 L14.4 8.2"/>
            <path d="M5.6 8.2 V13.6 M9.5 8.2 V13.6 M13.4 8.2 V13.6"/>
            <path d="M4.8 13.6 H14.2"/>
        `)),
        addSvgIcon(mapInstance, 'pm-icon-artwork', poiIconSvg(`
            <rect x="5.2" y="5.2" width="8.6" height="8.6" rx="0.8"/>
            <circle cx="8" cy="8.2" r="1.1"/>
            <path d="M5.8 13.2 L8.4 10.4 L10.2 12 L13.2 8.8"/>
        `)),
        addSvgIcon(mapInstance, 'pm-icon-attraction', poiIconSvg(`
            <path d="M9.5 4.6 L10.8 8.2 H14.4 L11.4 10.4 L12.6 14 L9.5 11.8 L6.4 14 L7.6 10.4 L4.6 8.2 H8.2 Z"/>
        `)),
        addSvgIcon(mapInstance, 'pm-icon-viewpoint', poiIconSvg(`
            <path d="M4.6 9.5 Q9.5 5.2 14.4 9.5 Q9.5 13.8 4.6 9.5 Z"/>
            <circle cx="9.5" cy="9.5" r="1.6"/>
        `)),
        addSvgIcon(mapInstance, 'pm-icon-square', poiIconSvg(`
            <rect x="5" y="5" width="9" height="9" rx="0.6"/>
            <path d="M5 9.5 H14 M9.5 5 V14"/>
        `)),
    ]);
}

function osmTypeId(feature) {
    const props = feature.properties || {};
    if (props.osm_type && props.osm_id != null) {
        return `${props.osm_type}/${props.osm_id}`;
    }

    if (feature.id == null || feature.id === '') {
        return props.kind ? `unknown/? (${props.kind})` : 'unknown/?';
    }

    try {
        const packed = BigInt(feature.id);
        const typeBits = Number(packed >> 44n);
        const osmId = packed & ((1n << 44n) - 1n);
        const osmType = OSM_TYPES[typeBits] || 'unknown';
        return `${osmType}/${osmId}`;
    } catch {
        return String(feature.id);
    }
}
