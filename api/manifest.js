// GET /api/manifest?child=<slug> — per-child PWA manifest, so an installed app
// launches into the right child's board (start_url was hardcoded to one child).
// Public by design and deliberately generic: it only echoes the slug back into
// start_url. The personalized "<Name>'s World" title is set in-page after an
// authenticated fetch, so child names can't be enumerated by guessing slugs.
//
// GET /api/manifest?app=versions — the native apps' launch version gate.
// Public by design (no auth, no child data, no spend): each platform gets
//   { minBuild, softBuild, updateUrl, note }
// minBuild  — builds BELOW this are blocked with a full-screen update wall.
// softBuild — builds below this see a dismissible "update available" nudge.
// Everything comes from env (APP_{MIN,SOFT}_BUILD_{IOS,ANDROID},
// APP_UPDATE_URL_{IOS,ANDROID}, APP_UPDATE_NOTE); unset → 0/null → gate off,
// so a fresh deploy can never lock anyone out by accident. Clients fail open
// on any fetch/parse error — availability beats freshness for an AAC device.
export default function handler(req, res) {
  if (String((req.query || {}).app || '') === 'versions') {
    const num = (v) => { const n = parseInt(v || '', 10); return Number.isFinite(n) && n > 0 ? n : 0; };
    const str = (v) => (v && String(v).trim()) || null;
    res.setHeader('Content-Type', 'application/json');
    // Short cache: gates flip via env + redeploy (rare); five minutes keeps
    // launch checks cheap without leaving a flipped gate stale for long.
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({
      ios: {
        minBuild: num(process.env.APP_MIN_BUILD_IOS),
        softBuild: num(process.env.APP_SOFT_BUILD_IOS),
        updateUrl: str(process.env.APP_UPDATE_URL_IOS),
        note: str(process.env.APP_UPDATE_NOTE),
      },
      android: {
        minBuild: num(process.env.APP_MIN_BUILD_ANDROID),
        softBuild: num(process.env.APP_SOFT_BUILD_ANDROID),
        updateUrl: str(process.env.APP_UPDATE_URL_ANDROID),
        note: str(process.env.APP_UPDATE_NOTE),
      },
    });
    return;
  }
  const raw = String((req.query || {}).child || '').slice(0, 64);
  const slug = /^[a-z0-9_-]+$/i.test(raw) ? raw : '';
  res.setHeader('Content-Type', 'application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json({
    name: 'My World: Tap to Talk',
    short_name: 'My World',
    description: "An AAC communication app built from your child's own world.",
    start_url: slug ? `/u/${slug}` : '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#ff1493',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
}
