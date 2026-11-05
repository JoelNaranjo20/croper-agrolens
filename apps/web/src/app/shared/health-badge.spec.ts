import { TestBed } from '@angular/core/testing';
import { HealthBadge } from './health-badge';

describe('HealthBadge', () => {
  it('renders the Spanish label for a health state', async () => {
    const fixture = TestBed.createComponent(HealthBadge);
    fixture.componentRef.setInput('health', 'stressed');
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('Estrés');
  });

  it('shows "Sin datos" without observations', async () => {
    const fixture = TestBed.createComponent(HealthBadge);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('Sin datos');
  });
});
