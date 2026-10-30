import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Map, Marker, type GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { carOffsetPx } from '../lib/navigation/drivingCamera';
import type { KakaoMapHandle, MapInsets, RoutePoint } from './types';

interface Props {
  ref?: Ref<KakaoMapHandle>;
  onReady?: () => void;
  onUserPan?: () => void;
}

type FollowOptions = { level: number; headingDeg: number | null; insets: MapInsets };
const coordinates = (points: RoutePoint[]): [number, number][] => points.map(p => [p.lng, p.lat]);
const lineData = (points: RoutePoint[]) => ({
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: coordinates(points) },
});

function arrowElement(label: string) {
  const root = document.createElement('div');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);
  root.dataset.navigationMarker = 'true';
  Object.assign(root.style, {
    width: '58px', height: '58px', borderRadius: '50%', boxSizing: 'border-box',
    background: '#fff', border: '3px solid #0866ff', boxShadow: '0 2px 10px #0866ff55',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '36');
  svg.setAttribute('height', '36');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M12 2.5 L20 21 L12 16.5 L4 21 Z');
  path.setAttribute('fill', '#0866ff');
  svg.appendChild(path);
  root.appendChild(svg);
  return root;
}

/** Vector driving map: the renderer rotates the roads while labels stay upright. */
export function NavigationMap({ ref, onReady, onUserPan }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const destinationRef = useRef<Marker | null>(null);
  const headingRef = useRef(0);
  const zoomOffsetRef = useRef(0);
  const lastFollowRef = useRef<{ point: RoutePoint; options: FollowOptions } | null>(null);
  const readyRef = useRef(onReady);
  const panRef = useRef(onUserPan);
  readyRef.current = onReady;
  panRef.current = onUserPan;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);

  const setRoutePath = (points: RoutePoint[]) => {
    const source = mapRef.current?.getSource('guidance-route') as GeoJSONSource | undefined;
    source?.setData(lineData(points));
  };
  const followTo = (point: RoutePoint, options: FollowOptions) => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;
    lastFollowRef.current = { point, options };
    const offset = carOffsetPx(0, { width: container.clientWidth, height: container.clientHeight }, options.insets);
    // Increase visible detail with actual vector zoom, never by stretching rendered pixels.
    const zoom = 18.6 + Math.max(0, Math.log2(container.clientWidth / 480));
    map.easeTo({
      center: [point.lng, point.lat], zoom: Math.max(17, Math.min(21, zoom + zoomOffsetRef.current)),
      bearing: options.headingDeg ?? map.getBearing(), pitch: 0,
      offset: [offset.dx, offset.dy], duration: 0,
    });
  };

  const adjustZoom = (delta: number) => {
    zoomOffsetRef.current = Math.max(-1.5, Math.min(2, zoomOffsetRef.current + delta));
    const last = lastFollowRef.current;
    if (last) followTo(last.point, last.options);
  };

  useImperativeHandle(ref, () => ({
    showRoute: (points, options) => {
      setRoutePath(points);
      if (options?.fit !== false && points.length > 1) {
        const lngs = points.map(p => p.lng);
        const lats = points.map(p => p.lat);
        mapRef.current?.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, duration: 0 });
      }
    },
    setRoutePath,
    clearRoute: () => setRoutePath([]),
    setLocationMarker: (point, options) => {
      const map = mapRef.current;
      if (!map) return;
      if (!point) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }
      headingRef.current = options?.headingDeg ?? 0;
      const label = t(options?.preview ? 'nav.startPreview' : 'map.myLocation');
      if (!markerRef.current) {
        markerRef.current = new Marker({ element: arrowElement(label), rotationAlignment: 'viewport', pitchAlignment: 'viewport' }).setLngLat([point.lng, point.lat]).addTo(map);
      }
      markerRef.current.setLngLat([point.lng, point.lat]).setRotation(headingRef.current - map.getBearing());
      markerRef.current.getElement().style.opacity = options?.preview ? '0.55' : '1';
      markerRef.current.getElement().setAttribute('aria-label', label);
    },
    setDestination: point => {
      destinationRef.current?.remove();
      destinationRef.current = point && mapRef.current ? new Marker({ color: '#202c3f' }).setLngLat([point.lng, point.lat]).addTo(mapRef.current) : null;
    },
    panTo: (point, options) => mapRef.current?.easeTo({ center: [point.lng, point.lat], zoom: options?.level ? 18.6 : undefined, duration: 180 }),
    followTo,
    moveToMyLocation: () => {
      const last = lastFollowRef.current;
      if (last) followTo(last.point, last.options);
    },
  }));

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setStatus('loading');
    let map: Map;
    try {
      map = new Map({
        container, style: 'https://tiles.openfreemap.org/styles/liberty',
        center: [127.085, 37.56], zoom: 18.6, pitch: 0, maxPitch: 0,
        attributionControl: false, maxZoom: 21, dragRotate: false,
      });
    } catch {
      setStatus('error');
      return;
    }
    mapRef.current = map;
    // Some POI classes have no icon in the provider's sprite. Keep their text labels
    // without repeatedly emitting a missing-image warning on every rendered tile.
    map.on('styleimagemissing', event => {
      if (!map.hasImage(event.id)) map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    map.on('error', () => { if (!map.getSource('guidance-route')) setStatus('error'); });
    map.on('load', () => {
      for (const layer of map.getStyle().layers) {
        if (layer.type === 'fill-extrusion') {
          map.addLayer({
            id: `${layer.id}-footprint`, type: 'fill', source: layer.source,
            'source-layer': layer['source-layer'], minzoom: layer.minzoom,
            maxzoom: layer.maxzoom, filter: layer.filter,
            paint: { 'fill-color': '#e2e3e6', 'fill-outline-color': '#c7c9cd' },
          }, layer.id);
          map.setLayoutProperty(layer.id, 'visibility', 'none');
        }
        if (layer.type === 'symbol') {
          // Point labels retain their normal font size and face the viewer through turns.
          map.setLayoutProperty(layer.id, 'text-rotation-alignment', 'viewport');
          map.setLayoutProperty(layer.id, 'text-pitch-alignment', 'viewport');
          if (layer.layout?.['text-field']) {
            map.setLayoutProperty(layer.id, 'text-field', ['coalesce', ['get', 'name:ko'], ['get', 'name'], ['get', 'name:latin']]);
          }
        }
        if (layer.type === 'fill' && layer.id.includes('building')) {
          map.setPaintProperty(layer.id, 'fill-color', '#e4e5e7');
          map.setPaintProperty(layer.id, 'fill-outline-color', '#d4d7da');
        }
      }
      map.addSource('guidance-route', { type: 'geojson', data: lineData([]) });
      const before = map.getStyle().layers.find(layer => layer.type === 'symbol')?.id;
      map.addLayer({ id: 'guidance-casing', type: 'line', source: 'guidance-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fff', 'line-width': 21 } }, before);
      map.addLayer({ id: 'guidance-line', type: 'line', source: 'guidance-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#0866ff', 'line-width': 14 } }, before);
      setStatus('ready');
      readyRef.current?.();
    });
    map.on('dragstart', () => panRef.current?.());
    map.on('move', () => {
      markerRef.current?.setRotation(headingRef.current - map.getBearing());
      container.dataset.bearing = String(map.getBearing());
      container.dataset.pitch = String(map.getPitch());
      container.dataset.zoom = String(map.getZoom());
    });
    const observer = new ResizeObserver(() => {
      map.resize();
      const last = lastFollowRef.current;
      if (last) followTo(last.point, last.options);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      markerRef.current?.remove();
      destinationRef.current?.remove();
      markerRef.current = null;
      destinationRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [attempt]);

  return <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', background: '#f2f1ed' }}>
    <div ref={containerRef} data-navigation-map="vector" style={{ width: '100%', height: '100%' }} />
    {status === 'ready' && <div style={{ position: 'absolute', top: 216, right: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button aria-label={t('nav.zoomIn')} onClick={() => adjustZoom(0.5)} style={{ width: 44, height: 44, border: 0, borderRadius: 22, background: '#fff', color: '#202c3f', fontSize: 28, boxShadow: '0 2px 8px #0002', cursor: 'pointer' }}>+</button>
      <button aria-label={t('nav.zoomOut')} onClick={() => adjustZoom(-0.5)} style={{ width: 44, height: 44, border: 0, borderRadius: 22, background: '#fff', color: '#202c3f', fontSize: 28, boxShadow: '0 2px 8px #0002', cursor: 'pointer' }}>−</button>
    </div>}
    {/* Keep map attribution readable outside the floating guidance panels. */}
    <div style={{ position: 'absolute', bottom: 0, right: 0, padding: '1px 4px', fontSize: 10, background: '#ffffffdd', zIndex: 1 }}>
      <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> · <a href="https://openmaptiles.org" target="_blank" rel="noreferrer">OpenMapTiles</a>
    </div>
    {status !== 'ready' && <div role={status === 'error' ? 'alert' : 'status'} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f2f1ed' }}>
      {t(status === 'error' ? 'map.loadError' : 'map.loading')}
      {status === 'error' && <button onClick={() => setAttempt(a => a + 1)}>{t('nav.retry')}</button>}
    </div>}
  </div>;
}
