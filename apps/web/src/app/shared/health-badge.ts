import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Health } from '../core/api/models';
import { HEALTH_INFO, NO_DATA_COLOR } from './crops';

@Component({
  selector: 'app-health-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [style.--c]="color()">{{ label() }}</span>`,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--c);
      background: color-mix(in srgb, var(--c) 14%, transparent);
      white-space: nowrap;
    }
    .badge::before {
      content: '';
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 50%;
      background: var(--c);
    }
  `,
})
export class HealthBadge {
  readonly health = input<Health | null | undefined>(null);
  protected readonly label = computed(() => {
    const h = this.health();
    return h ? HEALTH_INFO[h].label : 'Sin datos';
  });
  protected readonly color = computed(() => {
    const h = this.health();
    return h ? HEALTH_INFO[h].color : NO_DATA_COLOR;
  });
}
