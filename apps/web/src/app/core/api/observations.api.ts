import { HttpClient, HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { filter, firstValueFrom, map, tap } from 'rxjs';
import { NetworkStatus } from '../offline/network-status';
import { UploadQueue } from '../offline/upload-queue';
import type { Observation } from './models';

export type UploadResult = { status: 'uploaded'; observation: Observation } | { status: 'queued' };

/** Binary traffic goes over REST (multipart), proxied by the gateway to fields-service. */
@Injectable({ providedIn: 'root' })
export class ObservationsApi {
  private readonly http = inject(HttpClient);
  private readonly queue = inject(UploadQueue);
  private readonly network = inject(NetworkStatus);
  private flushing = false;

  /** Uploads now if online; otherwise (or on network failure) persists to the offline queue. */
  async upload(
    fieldId: string,
    image: Blob,
    onProgress?: (pct: number) => void,
  ): Promise<UploadResult> {
    if (!this.network.online()) {
      await this.queue.add(fieldId, image);
      return { status: 'queued' };
    }
    try {
      return { status: 'uploaded', observation: await this.send(fieldId, image, onProgress) };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 0 && this.queue.available) {
        await this.queue.add(fieldId, image);
        return { status: 'queued' };
      }
      throw err;
    }
  }

  /** Drains the offline queue; items rejected by the server (4xx) are dropped, not retried forever. */
  async flushQueue(): Promise<number> {
    if (this.flushing || !this.network.online()) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      for (const item of this.queue.pending()) {
        try {
          await this.send(item.fieldId, item.blob);
          await this.queue.remove(item.id);
          sent++;
        } catch (err) {
          if (err instanceof HttpErrorResponse && err.status >= 400 && err.status < 500) {
            await this.queue.remove(item.id);
          } else {
            break; // still offline / server down: keep the rest for later
          }
        }
      }
    } finally {
      this.flushing = false;
    }
    return sent;
  }

  private send(fieldId: string, image: Blob, onProgress?: (pct: number) => void) {
    const form = new FormData();
    form.append('image', image, 'photo.jpg');
    return firstValueFrom(
      this.http
        .post<Observation>(`/api/v1/fields/${encodeURIComponent(fieldId)}/observations`, form, {
          reportProgress: true,
          observe: 'events',
        })
        .pipe(
          tap((e) => {
            if (e.type === HttpEventType.UploadProgress && e.total) {
              onProgress?.(Math.round((100 * e.loaded) / e.total));
            }
          }),
          filter((e) => e.type === HttpEventType.Response),
          map((e) => e.body as Observation),
        ),
    );
  }
}
