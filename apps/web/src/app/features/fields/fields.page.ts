import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FieldsApi } from '../../core/api/fields.api';
import { GraphqlError } from '../../core/api/graphql.client';
import { CROPS, type Crop, type FieldSummary } from '../../core/api/models';
import { CROP_INFO, fmt } from '../../shared/crops';
import { type BBox, FieldMap } from '../../shared/field-map';
import { HealthBadge } from '../../shared/health-badge';

@Component({
  selector: 'app-fields-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FieldMap, HealthBadge, RouterLink],
  template: `
    <section class="layout">
      <app-field-map
        class="map card"
        [fields]="visible()"
        [selectedId]="selectedId()"
        (boundsChange)="onBounds($event)"
        (fieldSelect)="select($event)"
      />

      <div class="panel">
        <div class="chips" role="group" aria-label="Filtrar por cultivo">
          <button type="button" class="chip" [class.on]="!crop()" (click)="crop.set(null)">
            Todos
          </button>
          @for (c of crops; track c) {
            <button
              type="button"
              class="chip"
              [class.on]="crop() === c"
              [style.--c]="cropInfo[c].color"
              (click)="crop.set(crop() === c ? null : c)"
            >
              {{ cropInfo[c].label }}
            </button>
          }
        </div>

        @if (error()) {
          <p class="alert" role="alert">{{ error() }}</p>
        }

        <h2 class="count">
          {{ visible().length }} lote{{ visible().length === 1 ? '' : 's' }}
          @if (loading()) {
            <span class="muted">· actualizando…</span>
          }
        </h2>

        <ul class="list">
          @for (f of visible(); track f.id) {
            <li>
              <a
                class="item card"
                [routerLink]="['/fields', f.id]"
                [class.selected]="f.id === selectedId()"
                [style.--c]="cropInfo[f.crop].color"
              >
                <span class="swatch" aria-hidden="true"></span>
                <span class="meta">
                  <strong>{{ f.name }}</strong>
                  <small>{{ cropInfo[f.crop].label }} · {{ fmt.ha(f.areaHa) }}</small>
                </span>
                <app-health-badge [health]="f.latestObservation?.health" />
              </a>
            </li>
          } @empty {
            @if (!loading()) {
              <li class="empty card">
                <p>No hay lotes en esta zona.</p>
                <a routerLink="/fields/new" class="btn">Dibujar el primero</a>
              </li>
            }
          }
        </ul>
      </div>
    </section>

    <a routerLink="/fields/new" class="fab" aria-label="Nuevo lote">
      <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
        <path fill="currentColor" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2Z" />
      </svg>
    </a>
  `,
  styleUrl: './fields.page.scss',
})
export class FieldsPage {
  private readonly api = inject(FieldsApi);
  private readonly router = inject(Router);

  protected readonly crops = CROPS;
  protected readonly cropInfo = CROP_INFO;
  protected readonly fmt = fmt;

  protected readonly fields = signal<FieldSummary[]>([]);
  protected readonly crop = signal<Crop | null>(null);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** Crop filtering is client-side: instant, and works on cached (offline) data. */
  protected readonly visible = computed(() => {
    const c = this.crop();
    return c ? this.fields().filter((f) => f.crop === c) : this.fields();
  });

  private initialLoaded = false;
  private requestSeq = 0;

  constructor() {
    void this.load();
  }

  protected onBounds(bbox: BBox): void {
    // The first moveend comes from fitBounds on the initial (unbounded) load: skip it.
    if (!this.initialLoaded) return;
    void this.load(bbox);
  }

  protected select(id: string): void {
    if (this.selectedId() === id) void this.router.navigate(['/fields', id]);
    else this.selectedId.set(id);
  }

  private async load(bbox?: BBox): Promise<void> {
    const seq = ++this.requestSeq; // drop out-of-order responses while panning quickly
    this.loading.set(true);
    try {
      const page = await this.api.list({ bbox, limit: 100 });
      if (seq !== this.requestSeq) return;
      this.fields.set(page.items);
      this.error.set(null);
    } catch (err) {
      if (seq !== this.requestSeq) return;
      this.error.set(
        err instanceof GraphqlError && err.code === 'NETWORK'
          ? 'Sin conexión. Mostrando la última información guardada.'
          : 'No se pudieron cargar los lotes.',
      );
    } finally {
      if (seq === this.requestSeq) {
        this.loading.set(false);
        setTimeout(() => (this.initialLoaded = true), 600);
      }
    }
  }
}
