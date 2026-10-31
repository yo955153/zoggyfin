import { hashId, M3uParser, parseAttributes, parseM3u, splitExtinf } from '../m3u';
import { bigM3u, inChunks, SAMPLE_M3U } from '../test-utils/fixtures';

describe('parseAttributes', () => {
  it('reads double, single and unquoted values', () => {
    expect(parseAttributes(` tvg-id="a b" tvg-logo='x.png' group-title=News`)).toEqual({ 'tvg-id': 'a b', 'tvg-logo': 'x.png', 'group-title': 'News' });
  });
  it('keeps the first of a repeated key and lower-cases keys', () => {
    expect(parseAttributes('TVG-ID="one" tvg-id="two"')).toEqual({ 'tvg-id': 'one' });
  });
});

describe('splitExtinf', () => {
  it('splits at the first comma outside quotes', () => {
    expect(splitExtinf('-1 group-title="Sport, Live",Sport One')).toEqual({ attrs: '-1 group-title="Sport, Live"', name: 'Sport One' });
  });
  it('keeps commas and apostrophes in the name', () => {
    expect(splitExtinf("-1 tvg-id=\"x\",Bob's Show, Part 2").name).toBe("Bob's Show, Part 2");
  });
  it('falls back to the last comma for an unclosed quote', () => {
    expect(splitExtinf('-1 tvg-name="Broken,Name').name).toBe('Name');
  });
});

describe('M3uParser', () => {
  it('reads the sample playlist', async () => {
    const r = await parseM3u(inChunks(SAMPLE_M3U, 7));
    expect(r.looksLikeM3u).toBe(true);
    expect(r.guideUrls).toEqual(['https://epg.example.com/guide.xml.gz', 'https://epg.example.com/extra.xml']);
    expect(r.channels.map((c) => c.name)).toEqual(['Example News HD', 'Sport One', 'Cartoon "Fun" Time, Extra', 'No Attributes', 'Only TVG Name', 'Only TVG Name', 'orphan channel.ts']);
    const [news, sport, kids, music, tvgName, dup, orphan] = r.channels;
    expect(news).toMatchObject({ epgId: 'news.example', logo: 'https://img.example.com/news.png', group: 'News', number: 101, url: 'http://stream.example.com/live/jane/secret/1001.ts' });
    expect(news.userAgent).toBeUndefined();
    expect(sport).toMatchObject({ epgId: 'sport.example', logo: 'https://img.example.com/sport.png', group: 'Sport, Live', userAgent: 'ExampleAgent/1.0' });
    expect(kids).toMatchObject({ group: 'Kids', archiveDays: 3, url: 'https://cdn.example.com/kids/index.m3u8?token=abc' });
    expect(music.group).toBe('Music');
    expect(tvgName.group).toBe('');
    // Same name and no guide id: the second one gets its own id.
    expect(dup.id).toBe(`${tvgName.id}-1`);
    expect(orphan.group).toBe('');
  });

  it('gives the same ids for the same list in any chunking', async () => {
    const a = await parseM3u(inChunks(SAMPLE_M3U, 3));
    const b = await parseM3u(inChunks(SAMPLE_M3U, 10_000));
    expect(a.channels).toEqual(b.channels);
  });

  it('keeps ids when only the token in the URL changes', () => {
    const p1 = new M3uParser();
    p1.push('#EXTM3U\n#EXTINF:-1 tvg-id="a",A\nhttp://example.com/a?token=1\n');
    const p2 = new M3uParser();
    p2.push('#EXTM3U\n#EXTINF:-1 tvg-id="a",A\nhttp://example.com/a?token=2\n');
    expect(p1.end().channels[0].id).toBe(p2.end().channels[0].id);
  });

  it('says when the text is not a playlist', async () => {
    const r = await parseM3u(inChunks('<html><body>Login</body></html>', 5));
    expect(r.looksLikeM3u).toBe(false);
  });

  it('stops at the channel cap', () => {
    const p = new M3uParser({ maxChannels: 10 });
    p.push(bigM3u(50));
    expect(p.end().channels).toHaveLength(10);
  });

  it('parses 50 000 entries quickly', async () => {
    const text = bigM3u(50_000);
    const t0 = Date.now();
    const r = await parseM3u(inChunks(text, 512 * 1024));
    const ms = Date.now() - t0;
    expect(r.channels).toHaveLength(50_000);
    expect(new Set(r.channels.map((c) => c.id)).size).toBe(50_000);
    expect(r.channels[49_999]).toMatchObject({ name: 'Channel 49999 HD', group: 'Group 39', epgId: 'ch49999.example' });
    // A loose bound: catches a quadratic parse, not a slow CI machine running suites in parallel.
    expect(ms).toBeLessThan(20_000);
  });
});

describe('hashId', () => {
  it('is stable and short', () => {
    expect(hashId('abc')).toBe(hashId('abc'));
    expect(hashId('abc')).not.toBe(hashId('abd'));
    expect(hashId('x'.repeat(1000)).length).toBeLessThanOrEqual(7);
  });
});
