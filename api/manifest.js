// GET /api/manifest?child=<slug> — per-child PWA manifest, so an installed app
// launches into the right child's board (start_url was hardcoded to one child).
// Public by design and deliberately generic: it only echoes the slug back into
// start_url. The personalized "<Name>'s World" title is set in-page after an
// authenticated fetch, so child names can't be enumerated by guessing slugs.
export default function handler(req, res) {
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
