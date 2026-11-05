import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FieldsApi } from '../../core/api/fields.api';
import type { FieldDetail, Observation, YieldForecast } from '../../core/api/models';
import { ObservationsApi } from '../../core/api/observations.api';
import { UploadQueue } from '../../core/offline/upload-queue';
import { compressImage } from '../../core/util/image-compression';
import { CROP_INFO, fmt } from '../../shared/crops';
import { FieldMap } from '../../shared/field-map';
import { HealthBadge } from '../../shared/health-badge';

@Component({
  selector: 'app-field-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FieldMap, HealthBadge, RouterLink, FormsModule],
  templateUrl: './field-detail.page.html',
  styleUrl: './field-detail.page.scss',
})
export class FieldDetailPage {
  /** Bound from the route param via withComponentInputBinding(). */
  readonly id = input.required<string>();

  private readonly fieldsApi = inject(FieldsApi);
  private readonly observationsApi = inject(ObservationsApi);
  private readonly queue = inject(UploadQueue);
  private readonly router = inject(Router);

  protected readonly cropInfo = CROP_INFO;
  protected readonly fmt = fmt;

  protected readonly field = signal<FieldDetail | null>(null);
  protected readonly notFound = signal(false);
  protected readonly loadError = signal(false);
  protected readonly fieldAsList = computed(() => {
    const f = this.field();
    return f ? [f] : [];
  });

  protected readonly observations = signal<Observation[]>([]);
  protected readonly obsCursor = signal<string | null>(null);

  protected readonly uploadPct = signal<number | null>(null);
  protected readonly uploadMsg = signal<string | null>(null);
  protected readonly pendingHere = computed(() =>
    this.queue.pending().filter((p) => p.fieldId === this.id()),
  );

  protected rainfallMm = 1500;
  protected avgTempC = 22;
  protected readonly forecast = signal<YieldForecast | null>(null);
  protected readonly forecasting = signal(false);
  protected readonly forecastError = signal<string | null>(null);

  protected readonly confirmDelete = signal(false);

  constructor() {
    effect(() => void this.load(this.id()));
  }

  private async load(id: string): Promise<void> {
    this.field.set(null);
    this.forecast.set(null);
    try {
      const field = await this.fieldsApi.get(id);
      if (!field) {
        this.notFound.set(true);
        return;
      }
      this.field.set(field);
      const defaults = CROP_INFO[field.crop];
      this.rainfallMm = defaults.rainMm;
      this.avgTempC = defaults.tempC;
      const page = await this.fieldsApi.observations(id);
      this.observations.set(page.items);
      this.obsCursor.set(page.nextCursor);
    } catch {
      this.loadError.set(true);
    }
  }

  protected async loadMore(): Promise<void> {
    const page = await this.fieldsApi.observations(this.id(), this.obsCursor());
    this.observations.update((xs) => [...xs, ...page.items]);
    this.obsCursor.set(page.nextCursor);
  }

  protected async onPhoto(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const file = inputEl.files?.[0];
    inputEl.value = ''; // allow re-selecting the same file
    if (!file) return;

    this.uploadMsg.set('Optimizando foto…');
    this.uploadPct.set(0);
    try {
      const blob = await compressImage(file);
      this.uploadMsg.set(`Subiendo (${Math.round(blob.size / 1024)} kB)…`);
      const res = await this.observationsApi.upload(this.id(), blob, (p) => this.uploadPct.set(p));
      if (res.status === 'queued') {
        this.uploadMsg.set('Sin conexión: la foto se enviará automáticamente al reconectar.');
      } else {
        this.uploadMsg.set(null);
        this.observations.update((xs) => [res.observation, ...xs]);
        this.field.update((f) =>
          f
            ? {
                ...f,
                latestObservation: {
                  observationId: res.observation.id,
                  capturedAt: res.observation.capturedAt,
                  vegetationCoverage: res.observation.vegetationCoverage,
                  stressRatio: res.observation.stressRatio,
                  health: res.observation.health,
                },
              }
            : f,
        );
        this.forecast.set(null); // coverage changed: previous forecast is stale
      }
    } catch {
      this.uploadMsg.set('No se pudo analizar la foto. Usa JPG, PNG o WebP.');
    } finally {
      this.uploadPct.set(null);
    }
  }

  protected async runForecast(): Promise<void> {
    this.forecasting.set(true);
    this.forecastError.set(null);
    try {
      this.forecast.set(
        await this.fieldsApi.forecast(this.id(), Number(this.rainfallMm), Number(this.avgTempC)),
      );
    } catch {
      this.forecastError.set('No se pudo calcular el pronóstico.');
    } finally {
      this.forecasting.set(false);
    }
  }

  /** Position (0–100%) of a value within the P10–P90 band, for the range bar. */
  protected bandPct(f: YieldForecast): number {
    const { p10, p50, p90 } = f.totalT;
    return p90 === p10 ? 50 : ((p50 - p10) / (p90 - p10)) * 100;
  }

  protected async remove(): Promise<void> {
    if (!this.confirmDelete()) {
      this.confirmDelete.set(true);
      setTimeout(() => this.confirmDelete.set(false), 4000);
      return;
    }
    await this.fieldsApi.delete(this.id());
    await this.router.navigate(['/'], { replaceUrl: true });
  }

  protected imageSrc(o: Observation): string {
    return `/api${o.imageUrl}`;
  }
}
