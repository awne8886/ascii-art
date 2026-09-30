import { lazy, Suspense, useEffect, useState } from 'react';
import { App } from './App';

const ProApp = lazy(() => import('./pro/ProApp').then((m) => ({ default: m.ProApp })));

export type Route = 'classic' | 'pro' | 'sheet';

function routeOf(hash: string): Route {
  if (hash.startsWith('#/pro-sheet') && import.meta.env.DEV) return 'sheet';
  if (hash.startsWith('#/pro')) return 'pro';
  return 'classic';
}

/** Classic site at `/`, the PRO studio at `#/pro` (loaded on demand). */
export function Root() {
  const [route, setRoute] = useState<Route>(() => routeOf(location.hash));

  useEffect(() => {
    const onHash = () => setRoute(routeOf(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (route === 'sheet') return <DevSheet />;
  if (route === 'pro') {
    return (
      <Suspense fallback={<div className="pro-loading">loading pro studio…</div>}>
        <ProApp />
      </Suspense>
    );
  }
  return <App />;
}

function DevSheet() {
  useEffect(() => {
    const el = document.getElementById('sheet-root');
    if (el) void import('./pro/dev/sheet').then((m) => m.mountSheet(el));
  }, []);
  return <div id="sheet-root" />;
}
