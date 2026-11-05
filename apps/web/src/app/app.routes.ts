import type { Routes } from '@angular/router';

/** Every feature is lazy-loaded: the initial bundle is just the shell. */
export const routes: Routes = [
  {
    path: '',
    title: 'Lotes · AgroLens',
    loadComponent: () => import('./features/fields/fields.page').then((m) => m.FieldsPage),
  },
  {
    path: 'fields/new',
    title: 'Nuevo lote · AgroLens',
    loadComponent: () => import('./features/fields/field-new.page').then((m) => m.FieldNewPage),
  },
  {
    path: 'fields/:id',
    title: 'Lote · AgroLens',
    loadComponent: () =>
      import('./features/fields/field-detail.page').then((m) => m.FieldDetailPage),
  },
  { path: '**', redirectTo: '' },
];
