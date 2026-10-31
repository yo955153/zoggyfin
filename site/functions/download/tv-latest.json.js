// GET /download/tv-latest.json: the Android TV update feed, served from this origin (the feed
// sends no CORS headers). The download page reads it to show the newest TV version and its notes.
const FEED = 'https://releases.zog-tech.com/zoggyfin/android-tv/latest.json';

async function feed({ request }) {
  const upstream = await fetch(FEED, { cf: { cacheTtl: 0 } });
  return new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const onRequestGet = feed;
export const onRequestHead = feed;
