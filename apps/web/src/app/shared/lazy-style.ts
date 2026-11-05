const loaded = new Map<string, Promise<void>>();

/**
 * Loads a non-injected global stylesheet bundle (see angular.json `inject: false`) on demand,
 * so Leaflet's CSS is only downloaded on screens that render a map.
 */
export function loadStyle(bundleName: string): Promise<void> {
  const href = `${bundleName}.css`;
  let p = loaded.get(href);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`Failed to load ${href}`));
      document.head.appendChild(link);
    });
    loaded.set(href, p);
  }
  return p;
}
