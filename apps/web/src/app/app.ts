import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ObservationsApi } from './core/api/observations.api';
import { NetworkStatus } from './core/offline/network-status';
import { UploadQueue } from './core/offline/upload-queue';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly network = inject(NetworkStatus);
  protected readonly queue = inject(UploadQueue);
  private readonly observations = inject(ObservationsApi);

  constructor() {
    void this.queue.load();
    // Flush the offline photo outbox whenever connectivity returns.
    effect(() => {
      if (this.network.online() && this.queue.count() > 0) void this.observations.flushQueue();
    });
  }
}
