import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { FieldsApi } from '../../core/api/fields.api';
import { GraphqlError } from '../../core/api/graphql.client';
import { CROPS, type Crop, type LngLat } from '../../core/api/models';
import { ringAreaHa } from '../../core/util/geo';
import { CROP_INFO, fmt } from '../../shared/crops';
import { FieldMap } from '../../shared/field-map';

@Component({
  selector: 'app-field-new-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FieldMap, ReactiveFormsModule, RouterLink],
  template: `
    <a routerLink="/" class="back">← Lotes</a>
    <h1>Nuevo lote</h1>
    <p class="muted">Toca el mapa para marcar los vértices del lote y cierra en el primer punto.</p>

    <app-field-map class="map card" mode="draw" (polygonChange)="ring.set($event)" />

    <p class="area" aria-live="polite">
      @if (ring()) {
        Área aproximada: <strong>{{ fmt.ha(areaHa()) }}</strong>
      } @else {
        Aún no hay un polígono dibujado.
      }
    </p>

    <form class="card form" [formGroup]="form" (ngSubmit)="save()">
      <label>
        Nombre del lote
        <input formControlName="name" autocomplete="off" placeholder="Ej. Lote Café 3" />
      </label>
      <label>
        Cultivo
        <select formControlName="crop">
          @for (c of crops; track c) {
            <option [value]="c">{{ cropInfo[c].label }}</option>
          }
        </select>
      </label>
      <div class="row">
        <label>
          pH del suelo <small class="muted">(opcional)</small>
          <input
            type="number"
            inputmode="decimal"
            step="0.1"
            min="3"
            max="10"
            formControlName="soilPh"
          />
        </label>
        <label>
          Fecha de siembra <small class="muted">(opcional)</small>
          <input type="date" formControlName="plantedAt" />
        </label>
      </div>

      @if (error()) {
        <p class="alert" role="alert">{{ error() }}</p>
      }

      <button class="btn" type="submit" [disabled]="form.invalid || !ring() || saving()">
        {{ saving() ? 'Guardando…' : 'Guardar lote' }}
      </button>
    </form>
  `,
  styles: `
    .back {
      display: inline-block;
      margin-bottom: 0.5rem;
    }
    h1 {
      margin: 0 0 0.25rem;
    }
    .map {
      height: 50vh;
      margin: 0.75rem 0 0.5rem;
      overflow: hidden;
    }
    .area {
      margin: 0 0 0.75rem;
    }
    .form {
      display: grid;
      gap: 0.9rem;
      padding: 1rem;
    }
    .row {
      display: grid;
      gap: 0.9rem;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    }
  `,
})
export class FieldNewPage {
  private readonly api = inject(FieldsApi);
  private readonly router = inject(Router);

  protected readonly crops = CROPS;
  protected readonly cropInfo = CROP_INFO;
  protected readonly fmt = fmt;

  protected readonly ring = signal<LngLat[] | null>(null);
  protected readonly areaHa = computed(() => ringAreaHa(this.ring() ?? []));
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    crop: ['coffee' as Crop, Validators.required],
    soilPh: [null as number | null, [Validators.min(3), Validators.max(10)]],
    plantedAt: [''],
  });

  protected async save(): Promise<void> {
    const ring = this.ring();
    if (this.form.invalid || !ring) return;
    this.saving.set(true);
    this.error.set(null);
    const { name, crop, soilPh, plantedAt } = this.form.getRawValue();
    try {
      const { id } = await this.api.create({
        name: name.trim(),
        crop,
        geometry: { type: 'Polygon', coordinates: [ring] },
        ...(soilPh != null && { soilPh: Number(soilPh) }),
        ...(plantedAt && { plantedAt }),
      });
      await this.router.navigate(['/fields', id], { replaceUrl: true });
    } catch (err) {
      this.error.set(
        err instanceof GraphqlError && err.code === 'BAD_USER_INPUT'
          ? `Revisa los datos: ${err.message}`
          : 'No se pudo guardar el lote. Intenta de nuevo.',
      );
    } finally {
      this.saving.set(false);
    }
  }
}
