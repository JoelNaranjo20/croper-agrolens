import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class NetworkStatus {
  private readonly state = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly online = this.state.asReadonly();

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => this.state.set(true));
    window.addEventListener('offline', () => this.state.set(false));
  }
}
