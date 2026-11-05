import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import type { FieldSummary, LngLat } from '../core/api/models';
import { closeRing } from '../core/util/geo';
import { HEALTH_INFO, NO_DATA_COLOR } from './crops';
import { loadStyle } from './lazy-style';

export type BBox = [number, number, number, number];

/** Default view: Antioquia, Colombia. */
const DEFAULT_CENTER: L.LatLngExpression = [6.25, -75.56];

/**
 * Leaflet wrapper. Leaflet (≈40 kB gz) instead of a WebGL map: works on low-end Android,
 * no API key, and tiles are cached by the service worker for offline viewing.
 */
@Component({
  selector: 'app-field-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #host class="map" role="application" aria-label="Mapa de lotes"></div>
    @if (locatable()) {
      <button type="button" class="locate" (click)="locate()" aria-label="Ir a mi ubicación">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.94 3A9 9 0 0 0 13 3.06V1h-2v2.06A9 9 0 0 0 3.06 11H1v2h2.06A9 9 0 0 0 11 20.94V23h2v-2.06A9 9 0 0 0 20.94 13H23v-2h-2.06ZM12 19a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z"
          />
        </svg>
      </button>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-height: 240px;
    }
    .map {
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: #dfe6d8;
    }
    .locate {
      position: absolute;
      right: 10px;
      bottom: 24px;
      z-index: 500;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      border: 0;
      background: #fff;
      color: var(--brand-700);
      box-shadow: 0 2px 6px rgb(0 0 0 / 25%);
      display: grid;
      place-items: center;
    }
  `,
})
export class FieldMap {
  readonly fields = input<FieldSummary[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly mode = input<'view' | 'draw'>('view');
  /** Fit the view to the fields the first time they arrive. */
  readonly fitOnLoad = input(true);
  readonly locatable = input(true);
  readonly interactive = input(true);

  readonly boundsChange = output<BBox>();
  readonly fieldSelect = output<string>();
  readonly polygonChange = output<LngLat[] | null>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly destroyRef = inject(DestroyRef);
  private map?: L.Map;
  private readonly layer = L.featureGroup();
  private readonly ready = signal(false);
  private fitted = false;

  constructor() {
    afterNextRender(async () => {
      const drawing = this.mode() === 'draw';
      // Geoman hooks into L.Map construction, so it must load before the map is created.
      await Promise.all([loadStyle('leaflet'), drawing ? this.loadGeoman() : null]);
      this.init();
      if (drawing) this.enableDrawing();
      this.ready.set(true);
    });

    effect(() => {
      const fields = this.fields();
      const selected = this.selectedId();
      if (this.ready()) this.render(fields, selected);
    });

    this.destroyRef.onDestroy(() => this.map?.remove());
  }

  locate(): void {
    this.map?.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true });
  }

  private init(): void {
    const interactive = this.interactive();
    const map = L.map(this.host().nativeElement, {
      center: DEFAULT_CENTER,
      zoom: 9,
      preferCanvas: true, // one canvas instead of N SVG nodes: smoother on low-end phones
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      attributionControl: true,
    });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
      crossOrigin: true,
    }).addTo(map);
    this.layer.addTo(map);

    let debounce: ReturnType<typeof setTimeout> | undefined;
    map.on('moveend', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        const b = map.getBounds();
        this.boundsChange.emit([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      }, 350);
    });
    this.map = map;
  }

  private render(fields: FieldSummary[], selectedId: string | null): void {
    this.layer.clearLayers();
    for (const f of fields) {
      const health = f.latestObservation?.health;
      const color = health ? HEALTH_INFO[health].color : NO_DATA_COLOR;
      const selected = f.id === selectedId;
      L.geoJSON(f.geometry, {
        style: {
          color: selected ? '#0d47a1' : color,
          weight: selected ? 4 : 2,
          fillColor: color,
          fillOpacity: selected ? 0.45 : 0.3,
        },
      })
        .bindTooltip(f.name, { sticky: true })
        .on('click', () => this.fieldSelect.emit(f.id))
        .addTo(this.layer);
    }

    if (this.fitOnLoad() && !this.fitted && fields.length) {
      this.fitted = true;
      this.map?.fitBounds(this.layer.getBounds(), { padding: [24, 24], maxZoom: 16 });
    }
  }

  private async loadGeoman(): Promise<void> {
    // Lazy: the drawing toolkit (~65 kB gz) is only downloaded on the "new field" screen.
    (window as unknown as { L: typeof L }).L = L;
    await Promise.all([loadStyle('leaflet-geoman'), import('@geoman-io/leaflet-geoman-free')]);
  }

  private enableDrawing(): void {
    const map = this.map!;
    map.pm.setLang('es');
    map.pm.addControls({
      position: 'topleft',
      drawMarker: false,
      drawCircleMarker: false,
      drawPolyline: false,
      drawRectangle: true,
      drawCircle: false,
      drawText: false,
      cutPolygon: false,
      rotateMode: false,
    });
    map.pm.setGlobalOptions({ allowSelfIntersection: false });

    const emit = (layer: L.Polygon) => {
      const latlngs = (layer.getLatLngs()[0] ?? []) as L.LatLng[];
      this.polygonChange.emit(closeRing(latlngs.map((p) => [p.lng, p.lat] as LngLat)));
    };

    map.on('pm:create', ({ layer }) => {
      // One field = one polygon: replace any previous drawing.
      map.pm
        .getGeomanDrawLayers()
        .filter((l) => l !== layer)
        .forEach((l) => l.remove());
      const poly = layer as L.Polygon;
      emit(poly);
      poly.on('pm:edit', () => emit(poly));
      poly.on('pm:remove', () => this.polygonChange.emit(null));
    });
    map.pm.enableDraw('Polygon');
  }
}
