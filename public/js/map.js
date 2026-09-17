import * as maplibregl from 'https://cdn.jsdelivr.net/npm/maplibre-gl@6.9.0/dist/maplibre-gl.mjs';
import { Protocol } from 'https://cdn.jsdelivr.net/npm/pmtiles@4.5.0/+esm';
import { layers, namedFlavor } from 'https://cdn.jsdelivr.net/npm/@protomaps/basemaps@5.7.2/+esm';
import { OVERPASS_ENDPOINTS, PMTILES_VERSION } from './config.js';

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
    'park',
];

const HIDDEN_LANDCOVER_KINDS = ['grass', 'grassland', 'scrub'];

const OSM_TYPES = {
    1: 'node',
    2: 'way',
    3: 'relation',
};

const POI_PINK = ['#EF56BA', '#F9EBFE'];
const POI_GREEN = ['#2F9E5F', '#E7F8EE'];

const KIND_LABELS = {
    monument: 'памятник',
    memorial: 'мемориал',
    museum: 'музей',
    artwork: 'арт-объект',
    art: 'арт-объект',
    attraction: 'достопримечательность',
    viewpoint: 'смотровая точка',
    square: 'площадь',
    plaza: 'площадь',
    park: 'парк',
};

const poiPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: false,
    maxWidth: '380px',
    className: 'poi-popup',
    offset: 18,
    anchor: 'bottom',
});

let overpassAbort = null;

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
const styleLayers = layers('protomaps', flavor, { lang: 'ru' })
    .map(restyleLayer)
    .filter(Boolean);

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
        poiPopup.remove();
        return;
    }
    openPoiPopup(pickPoiFeature(features, event.lngLat), event.lngLat);
});

map.on('mousemove', (event) => {
    if (!map.getLayer('pois')) {
        return;
    }
    const hovering = map.queryRenderedFeatures(event.point, { layers: ['pois'] }).length > 0;
    map.getCanvas().style.cursor = hovering ? 'pointer' : '';
});

function restyleLayer(layer) {
    if (layer.id === 'buildings' || layer.id === 'address_label' || layer.id === 'places_subplace') {
        return null;
    }
    if (layer.id === 'pois') {
        return restylePois(layer);
    }

    const next = {
        ...layer,
        layout: { ...(layer.layout || {}) },
        paint: { ...(layer.paint || {}) },
    };

    if (layer.id.startsWith('roads_')) {
        return restyleRoads(next);
    }
    if (layer.id.startsWith('landuse_') && layer.id !== 'landuse_park') {
        scalePaint(next.paint, 'fill-opacity', 0.28);
        return next;
    }
    if (layer.id === 'landuse_park' || layer.id === 'landcover') {
        scalePaint(next.paint, 'fill-opacity', 0.55);
        next.filter = excludeLanduseKinds(next.filter, HIDDEN_LANDCOVER_KINDS);
        return next;
    }
    if (layer.id.startsWith('boundaries')) {
        scalePaint(next.paint, 'line-opacity', 0.3);
        return next;
    }
    return next;
}

function restyleRoads(layer) {
    if (
        layer.id.includes('labels')
        || layer.id.includes('shields')
        || layer.id.includes('oneway')
    ) {
        layer.layout.visibility = 'none';
        return layer;
    }
    const casing = layer.id.includes('casing');
    const minor = /minor|other|link|service|pier|rail/.test(layer.id);
    let opacity = minor ? 0.21 : 0.315;
    if (casing) {
        opacity *= 0.45;
    }
    scalePaint(layer.paint, 'line-opacity', opacity);
    return layer;
}

function scalePaint(paint, prop, factor) {
    paint[prop] = factor;
}

function excludeLanduseKinds(filter, kinds) {
    if (Array.isArray(filter) && filter[0] === 'in' && filter[1] === 'kind') {
        const values = filter.slice(2).filter((kind) => !kinds.includes(kind));
        return values.length ? ['in', 'kind', ...values] : ['==', 'kind', '__none__'];
    }
    const notHidden = ['!', ['in', ['get', 'kind'], ['literal', kinds]]];
    return filter ? ['all', filter, notHidden] : notHidden;
}

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
    next.paint['text-color'] = [
        'match',
        ['get', 'kind'],
        'park', POI_GREEN[0],
        POI_PINK[0],
    ];
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
        'park', 'pm-icon-park',
        'pm-icon-attraction',
    ];
}

function poiIconSvg(glyph, palette = POI_PINK) {
    const [stroke, fill] = palette;
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
        addSvgIcon(mapInstance, 'pm-icon-park', poiIconSvg(`
            <path d="M9.5 4.6 C7.2 4.6 5.8 6.6 6.4 8.6 C5.2 8.8 4.6 10.2 5.4 11.4 H13.6 C14.4 10.2 13.8 8.8 12.6 8.6 C13.2 6.6 11.8 4.6 9.5 4.6 Z"/>
            <path d="M9.5 11.4 V14.4 M7.8 14.4 H11.2"/>
        `, POI_GREEN)),
    ]);
}

function openPoiPopup(feature, lngLat) {
    if (overpassAbort) {
        overpassAbort.abort();
    }
    overpassAbort = new AbortController();

    const props = feature.properties || {};
    const ref = parseOsmRef(feature);
    const card = document.createElement('div');
    card.className = 'poi-card';
    fillPoiCard(card, {
        title: props.name || 'Объект OSM',
        meta: kindLabel(props.kind),
        status: 'Загрузка данных OpenStreetMap…',
    });

    poiPopup.setLngLat(featureLngLat(feature, lngLat)).setDOMContent(card).addTo(map);

    if (!ref) {
        fillPoiCard(card, {
            title: props.name || 'Объект OSM',
            meta: kindLabel(props.kind),
            status: 'Не удалось определить OSM id',
        });
        return;
    }

    const requestId = overpassAbort;
    fetchOverpassTags(ref, requestId.signal).then((tags) => {
        if (requestId.signal.aborted) {
            return;
        }
        fillPoiCard(card, poiCardState(props, tags, {}, tags.wikipedia || tags.wikidata ? 'Загрузка описания…' : ''));
        if (!tags.wikipedia && !tags.wikidata) {
            return;
        }
        return fetchOpenExtras(tags, requestId.signal).then((extras) => {
            if (requestId.signal.aborted) {
                return;
            }
            fillPoiCard(card, poiCardState(props, tags, extras));
        }).catch(() => {
            if (!requestId.signal.aborted) {
                fillPoiCard(card, poiCardState(props, tags, {}));
            }
        });
    }).catch((error) => {
        if (error?.name === 'AbortError' || requestId.signal.aborted) {
            return;
        }
        fillPoiCard(card, {
            title: props.name || 'Объект OSM',
            meta: kindLabel(props.kind),
            status: 'Не удалось загрузить данные Overpass',
        });
    });
}

function poiCardState(props, tags, extras, status) {
    const wiki = extras.wiki || {};
    const wikidata = extras.wikidata || {};
    return {
        title: localizedTag(tags, 'name') || props.name || wikidata.label || wiki.title || 'Без названия',
        meta: poiMeta(props, tags),
        image: wiki.image || wikidata.image || '',
        desc: wiki.extract
            || localizedTag(tags, 'description')
            || wikidata.description
            || '',
        quote: tags.inscription || tags['inscription:ru'] || '',
        facts: mergeFacts(osmFacts(tags), wikidata.facts || []),
        status: status && !(wiki.extract || wikidata.description) ? status : '',
    };
}

function fillPoiCard(root, state) {
    root.replaceChildren();
    if (state.image) {
        const img = createEl('img', 'poi-card__photo');
        img.src = state.image;
        img.alt = state.title || '';
        img.addEventListener('load', keepPopupOnScreen);
        img.addEventListener('error', () => {
            img.remove();
            keepPopupOnScreen();
        });
        root.append(img);
    }
    const body = createEl('div', 'poi-card__body');
    body.append(createEl('h2', 'poi-card__title', state.title || 'Объект OSM'));
    if (state.meta) {
        body.append(createEl('p', 'poi-card__meta', state.meta));
    }
    if (state.status) {
        body.append(createEl('p', 'poi-card__status', state.status));
    }
    if (state.desc) {
        body.append(createEl('p', 'poi-card__desc', state.desc));
    }
    if (state.quote) {
        body.append(createEl('blockquote', 'poi-card__quote', state.quote));
    }
    if (state.facts?.length) {
        const list = createEl('dl', 'poi-card__facts');
        for (const fact of state.facts) {
            list.append(createEl('dt', null, fact.label));
            list.append(createEl('dd', null, fact.value));
        }
        body.append(list);
    }
    root.append(body);
    keepPopupOnScreen();
}

let popupPanFrame = 0;

function keepPopupOnScreen() {
    cancelAnimationFrame(popupPanFrame);
    popupPanFrame = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!poiPopup.isOpen()) {
                return;
            }
            const popupEl = poiPopup.getElement();
            const mapEl = map.getContainer();
            if (!popupEl || !mapEl) {
                return;
            }

            const pad = { top: 58, right: 52, bottom: 36, left: 12 };
            const pop = popupEl.getBoundingClientRect();
            const box = mapEl.getBoundingClientRect();
            const minTop = box.top + pad.top;
            const maxBottom = box.bottom - pad.bottom;
            const minLeft = box.left + pad.left;
            const maxRight = box.right - pad.right;

            let dx = 0;
            let dy = 0;
            if (pop.height >= maxBottom - minTop) {
                dy = pop.top - minTop;
            } else if (pop.top < minTop) {
                dy = pop.top - minTop;
            } else if (pop.bottom > maxBottom) {
                dy = pop.bottom - maxBottom;
            }
            if (pop.left < minLeft) {
                dx = pop.left - minLeft;
            } else if (pop.right > maxRight) {
                dx = pop.right - maxRight;
            }

            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
                map.panBy([dx, dy], { duration: 240 });
            }
        });
    });
}

function createEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text) {
        node.textContent = text;
    }
    return node;
}

function poiMeta(props, tags) {
    return uniqueText([
        kindLabel(props?.kind || tags.historic || tags.tourism || tags.memorial),
        displayValue(tags.memorial),
        displayValue(tags.artwork_type),
    ]).join(' · ');
}

function kindLabel(kind) {
    return KIND_LABELS[kind] || displayValue(kind) || kind || '';
}

function osmFacts(tags) {
    const facts = [];
    addFact(facts, 'Посвящён', formatList(localizedTag(tags, 'memorial:subject') || localizedTag(tags, 'subject')));
    addFact(facts, 'Скульптор', localizedTag(tags, 'artist') || localizedTag(tags, 'sculptor'));
    addFact(facts, 'Архитектор', localizedTag(tags, 'architect'));
    addFact(facts, 'Материал', displayValue(localizedTag(tags, 'material')));
    addFact(facts, 'Высота', formatHeight(tags.height));
    addFact(facts, 'Открыт', formatOsmDate(tags.opening_date || tags.start_date || tags.year));
    return facts.filter((fact) => fact.value);
}

function mergeFacts(primary, secondary) {
    const facts = [...primary];
    for (const fact of secondary) {
        addFact(facts, fact.label, fact.value);
    }
    return facts;
}

function addFact(facts, label, value) {
    if (!value || facts.some((fact) => fact.label === label)) {
        return;
    }
    facts.push({ label, value });
}

function localizedTag(tags, key) {
    return tags[key] || tags[`${key}:ru`] || tags[`${key}:en`] || '';
}

function uniqueText(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        if (!value || seen.has(value)) {
            continue;
        }
        seen.add(value);
        result.push(value);
    }
    return result;
}

function formatList(value) {
    return String(value || '').replace(/\s*;\s*/g, ', ').trim();
}

function formatHeight(value) {
    if (!value) {
        return '';
    }
    if (/[a-zа-я]/i.test(value)) {
        return value;
    }
    return `${value} м`;
}

function formatOsmDate(value) {
    if (!value) {
        return '';
    }
    let text = String(value).trim();
    let prefix = '';
    if (text.startsWith('~')) {
        prefix = 'около ';
        text = text.slice(1);
    }
    text = text.replace(/^j:/i, '').replace(/\.\./g, '–');
    return prefix + text;
}

const OSM_VALUE_LABELS = {
    bronze: 'бронза',
    granite: 'гранит',
    marble: 'мрамор',
    copper: 'медь',
    stone: 'камень',
    concrete: 'бетон',
    brick: 'кирпич',
    wood: 'дерево',
    statue: 'статуя',
    bust: 'бюст',
    plaque: 'мемориальная доска',
    stele: 'стела',
    cross: 'крест',
    sculpture: 'скульптура',
    artwork: 'арт-объект',
    building: 'здание',
    museum: 'музей',
    monument: 'памятник',
    memorial: 'мемориал',
};

function displayValue(value) {
    if (!value) {
        return '';
    }
    return value.split(';').map((part) => {
        const item = part.trim();
        return OSM_VALUE_LABELS[item] || item;
    }).filter(Boolean).join(', ');
}

function pickPoiFeature(features, lngLat) {
    if (features.length === 1) {
        return features[0];
    }
    let best = features[0];
    let bestDist = Infinity;
    for (const feature of features) {
        const geometry = feature.geometry;
        if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) {
            continue;
        }
        const dx = geometry.coordinates[0] - lngLat.lng;
        const dy = geometry.coordinates[1] - lngLat.lat;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
            bestDist = dist;
            best = feature;
        }
    }
    return best;
}

function featureLngLat(feature, fallback) {
    const geometry = feature.geometry;
    if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) {
        return { lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
    }
    return fallback;
}

function parseOsmRef(feature) {
    const match = /^(node|way|relation)\/(\d+)$/.exec(osmTypeId(feature));
    if (!match) {
        return null;
    }
    return { type: match[1], id: match[2], ref: match[0] };
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

function overpassQuery(ref) {
    return `[out:json][timeout:15];${ref.type}(${ref.id});out tags;`;
}

function fetchOverpassTags(ref, signal) {
    const query = overpassQuery(ref);
    let lastError = new Error('Overpass недоступен');

    const tryEndpoint = (index) => {
        if (signal?.aborted) {
            return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }
        if (index >= OVERPASS_ENDPOINTS.length) {
            return Promise.reject(lastError);
        }
        const url = `${OVERPASS_ENDPOINTS[index]}?data=${encodeURIComponent(query)}`;
        return xhrJson(url, signal).then((data) => {
            const tags = data?.elements?.[0]?.tags;
            if (tags && typeof tags === 'object') {
                return tags;
            }
            lastError = new Error(data?.remark || 'Пустой ответ Overpass');
            return tryEndpoint(index + 1);
        }).catch((error) => {
            if (error?.name === 'AbortError') {
                throw error;
            }
            lastError = error;
            return tryEndpoint(index + 1);
        });
    };

    return tryEndpoint(0);
}

function fetchOpenExtras(tags, signal) {
    const wikiRef = parseWikipediaRef(tags.wikipedia);
    const qid = parseWikidataId(tags.wikidata);
    if (!wikiRef && !qid) {
        return Promise.resolve({});
    }

    const tasks = [];
    if (wikiRef) {
        tasks.push(fetchWikipediaSummary(wikiRef, signal).then((wiki) => (wiki ? { wiki } : {})).catch(() => ({})));
    }
    if (qid) {
        tasks.push(fetchWikidata(qid, signal).then((wikidata) => ({ wikidata })).catch(() => ({})));
    }

    return Promise.all(tasks).then((parts) => {
        const extras = Object.assign({}, ...parts);
        if (extras.wiki || !extras.wikidata?.wiki) {
            return extras;
        }
        return fetchWikipediaSummary(extras.wikidata.wiki, signal)
            .then((wiki) => ({ ...extras, wiki }))
            .catch(() => extras);
    });
}

function parseWikidataId(value) {
    const match = String(value || '').match(/Q\d+/i);
    return match ? match[0].toUpperCase() : '';
}

function parseWikipediaRef(value) {
    if (!value) {
        return null;
    }
    const sep = value.indexOf(':');
    if (sep > 0 && sep <= 12) {
        return { lang: value.slice(0, sep), title: value.slice(sep + 1) };
    }
    return { lang: 'ru', title: value };
}

function fetchWikipediaSummary(ref, signal) {
    const title = encodeURIComponent(ref.title.replace(/ /g, '_'));
    const url = `https://${ref.lang}.wikipedia.org/api/rest_v1/page/summary/${title}`;
    return xhrJson(url, signal).then((data) => {
        if (!data || data.type === 'disambiguation' && !data.extract) {
            return null;
        }
        return {
            title: data.title || '',
            extract: data.extract || '',
            image: data.thumbnail?.source || data.originalimage?.source || '',
        };
    });
}

const WIKIDATA_FACTS = {
    P170: 'Скульптор',
    P84: 'Архитектор',
    P186: 'Материал',
    P571: 'Создан',
    P1619: 'Открыт',
    P2048: 'Высота',
    P138: 'Назван',
    P112: 'Основатель',
};

const WIKIDATA_UNITS = {
    Q11573: 'м',
    Q174728: 'см',
    Q218593: 'дюйм',
};

function fetchWikidata(qid, signal) {
    const url = wikidataApi({
        action: 'wbgetentities',
        ids: qid,
        props: 'labels|descriptions|claims|sitelinks',
        languages: 'ru|en',
        sitefilter: 'ruwiki|enwiki',
        format: 'json',
        origin: '*',
    });
    return xhrJson(url, signal).then((data) => {
        const entity = data?.entities?.[qid];
        if (!entity || entity.missing != null) {
            return null;
        }
        const claims = entity.claims || {};
        const relatedIds = [];
        for (const pid of Object.keys(WIKIDATA_FACTS)) {
            for (const value of claimRaw(claims, pid)) {
                if (value?.type === 'wikibase-entityid' && value.value?.id) {
                    relatedIds.push(value.value.id);
                }
                if (value?.type === 'quantity' && /Q\d+$/.test(value.value?.unit || '')) {
                    relatedIds.push(value.value.unit.split('/').pop());
                }
            }
        }
        const imageName = claimRaw(claims, 'P18')[0]?.value;
        return resolveWikidataLabels(relatedIds, signal).then((labels) => ({
            label: langValue(entity.labels),
            description: langValue(entity.descriptions),
            image: imageName ? commonsFileUrl(imageName) : '',
            wiki: sitelinkRef(entity.sitelinks),
            facts: wikidataFacts(claims, labels),
        }));
    });
}

function wikidataApi(params) {
    return `https://www.wikidata.org/w/api.php?${new URLSearchParams(params)}`;
}

function resolveWikidataLabels(ids, signal) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) {
        return Promise.resolve({});
    }
    const url = wikidataApi({
        action: 'wbgetentities',
        ids: unique.join('|'),
        props: 'labels',
        languages: 'ru|en',
        format: 'json',
        origin: '*',
    });
    return xhrJson(url, signal).then((data) => {
        const labels = {};
        for (const [id, entity] of Object.entries(data?.entities || {})) {
            labels[id] = langValue(entity.labels) || id;
        }
        return labels;
    }).catch(() => ({}));
}

function wikidataFacts(claims, labels) {
    const facts = [];
    for (const [pid, label] of Object.entries(WIKIDATA_FACTS)) {
        const values = claimRaw(claims, pid)
            .map((value) => formatWikidataValue(value, labels))
            .filter(Boolean);
        addFact(facts, label, uniqueText(values).join(', '));
    }
    return facts;
}

function claimRaw(claims, pid) {
    return (claims[pid] || [])
        .map((claim) => claim.mainsnak?.datavalue)
        .filter(Boolean);
}

function formatWikidataValue(datavalue, labels) {
    if (!datavalue) {
        return '';
    }
    if (datavalue.type === 'string') {
        return datavalue.value;
    }
    if (datavalue.type === 'wikibase-entityid') {
        const id = datavalue.value?.id;
        return labels[id] || '';
    }
    if (datavalue.type === 'time') {
        return formatWikidataTime(datavalue.value);
    }
    if (datavalue.type === 'quantity') {
        const amount = String(datavalue.value?.amount || '').replace(/^\+/, '');
        const unitId = String(datavalue.value?.unit || '').split('/').pop();
        const unit = WIKIDATA_UNITS[unitId] || labels[unitId] || '';
        return unit ? `${amount} ${unit}` : amount;
    }
    return '';
}

function formatWikidataTime(value) {
    const match = /^([+-])(\d+)-(\d+)-(\d+)/.exec(value?.time || '');
    if (!match) {
        return '';
    }
    const year = Number(match[2]) * (match[1] === '-' ? -1 : 1);
    const month = Number(match[3]);
    const day = Number(match[4]);
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    if ((value.precision || 0) <= 9 || !month) {
        return String(year);
    }
    if ((value.precision || 0) === 10 || !day) {
        return `${months[month - 1]} ${year}`;
    }
    return `${day} ${months[month - 1]} ${year}`;
}

function langValue(entries) {
    return entries?.ru?.value || entries?.en?.value || Object.values(entries || {})[0]?.value || '';
}

function sitelinkRef(sitelinks) {
    if (sitelinks?.ruwiki?.title) {
        return { lang: 'ru', title: sitelinks.ruwiki.title };
    }
    if (sitelinks?.enwiki?.title) {
        return { lang: 'en', title: sitelinks.enwiki.title };
    }
    return null;
}

function commonsFileUrl(filename) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=640`;
}

function xhrJson(url, signal) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'json';
        xhr.timeout = 7000;

        const onAbort = () => {
            xhr.abort();
            reject(new DOMException('Aborted', 'AbortError'));
        };

        if (signal) {
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }

        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(xhr.response || {});
                return;
            }
            reject(new Error(`HTTP ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error('Сеть'));
        xhr.ontimeout = () => reject(new Error('Таймаут'));
        xhr.send();
    });
}
