import type { Crop, Health } from '../core/api/models';

export const CROP_INFO: Record<
  Crop,
  { label: string; color: string; rainMm: number; tempC: number }
> = {
  maize: { label: 'Maíz', color: '#d9a400', rainMm: 900, tempC: 24 },
  coffee: { label: 'Café', color: '#7a4b2a', rainMm: 1900, tempC: 20 },
  rice: { label: 'Arroz', color: '#8fb36b', rainMm: 1600, tempC: 27 },
  potato: { label: 'Papa', color: '#b08a5a', rainMm: 900, tempC: 15 },
  avocado: { label: 'Aguacate', color: '#4c7a2e', rainMm: 1400, tempC: 19 },
  banana: { label: 'Banano', color: '#e0c341', rainMm: 2400, tempC: 27 },
  cocoa: { label: 'Cacao', color: '#6b3a2a', rainMm: 2000, tempC: 26 },
};

export const HEALTH_INFO: Record<Health, { label: string; color: string }> = {
  healthy: { label: 'Saludable', color: '#2e7d32' },
  moderate: { label: 'Moderado', color: '#c99a06' },
  stressed: { label: 'Estrés', color: '#c4511f' },
  bare: { label: 'Suelo desnudo', color: '#8d6e63' },
};

export const NO_DATA_COLOR = '#607d8b';

const nf1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('es-CO', { style: 'percent', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

export const fmt = {
  ha: (v: number) => `${nf2.format(v)} ha`,
  t: (v: number) => `${nf1.format(v)} t`,
  num: (v: number) => nf1.format(v),
  pct: (v: number) => pct.format(v),
  date: (iso: string) => date.format(new Date(iso)),
};
