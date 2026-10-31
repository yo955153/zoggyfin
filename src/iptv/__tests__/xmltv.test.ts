import { gzipSync } from 'fflate';

import { nowNext } from '../guide';
import { chunksOf, textChunks } from '../text-stream';
import { bigXmltv, inChunks, xmltvTime } from '../test-utils/fixtures';
import { decodeXml, parseXmltv, parseXmltvTime, XmltvWindowParser } from '../xmltv';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 31, 18, 0, 0);

describe('parseXmltvTime', () => {
  it('reads times with and without an offset', () => {
    expect(parseXmltvTime('20261031180000 +0000')).toBe(T0);
    expect(parseXmltvTime('20261031190000 +0100')).toBe(T0);
    expect(parseXmltvTime('20261031130000 -0500')).toBe(T0);
    expect(parseXmltvTime('202610311800')).toBe(T0);
    expect(parseXmltvTime('nonsense')).toBeNaN();
  });
});

describe('decodeXml', () => {
  it('decodes entities and CDATA', () => {
    expect(decodeXml('Tom &amp; Jerry &#233;t&#xE9; &lt;3&gt;')).toBe('Tom & Jerry été <3>');
    expect(decodeXml('<![CDATA[A & B]]>')).toBe('A & B');
  });
});

describe('XmltvWindowParser', () => {
  it('keeps only programmes in the window, at most a few per channel', async () => {
    const xml = bigXmltv(3, 24, T0 - 6 * HOUR);
    const { guide, names, looksLikeXmltv } = await parseXmltv(inChunks(xml, 333), { from: T0, to: T0 + 4 * HOUR, maxPerChannel: 3 });
    expect(looksLikeXmltv).toBe(true);
    expect(Object.keys(guide.channels).sort()).toEqual(['ch0.example', 'ch1.example', 'ch2.example']);
    const list = guide.channels['ch1.example'];
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ start: T0, stop: T0 + HOUR, title: 'Show 6 & Friends', description: 'Episode 6 of channel 1.' });
    expect(names.get('channel 2')).toBe('ch2.example');
    const nn = nowNext(list, T0 + 30 * 60_000);
    expect(nn.now?.title).toBe('Show 6 & Friends');
    expect(nn.next?.title).toBe('Show 7 & Friends');
  });

  it('skips channels it is not asked to keep', () => {
    const p = new XmltvWindowParser({ from: T0, to: T0 + HOUR, keep: new Set(['ch0.example']) });
    p.push(bigXmltv(3, 2, T0));
    expect(Object.keys(p.end().channels)).toEqual(['ch0.example']);
  });

  it('copes with tags split over chunks and odd spacing', () => {
    const xml = `<tv>\n<channels-note/>\n<programme\n start="${xmltvTime(T0)}"  stop='${xmltvTime(T0 + HOUR)}' channel="a"><title><![CDATA[Late & Live]]></title></programme><programme start="${xmltvTime(T0 + HOUR)}" stop="${xmltvTime(T0 + 2 * HOUR)}" channel="a"/></tv>`;
    for (const size of [1, 2, 5, 17]) {
      const p = new XmltvWindowParser({ from: T0, to: T0 + 3 * HOUR });
      for (let i = 0; i < xml.length; i += size) p.push(xml.slice(i, i + size));
      const list = p.end().channels.a;
      expect(list.map((x) => x.title)).toEqual(['Late & Live', 'No title']);
    }
  });

  it('reads a gzip guide through the byte pipeline', async () => {
    const xml = bigXmltv(2, 4, T0);
    const gz = gzipSync(new TextEncoder().encode(xml));
    const { guide } = await parseXmltv(textChunks(chunksOf(gz, 1000)), { from: T0, to: T0 + HOUR });
    expect(guide.channels['ch1.example'][0].title).toBe('Show 0 & Friends');
  });

  it('streams a large guide fast and keeps it small', async () => {
    // 2 000 channels × 48 hours: 96 000 programmes, about 25 MB of XML.
    const xml = bigXmltv(2000, 48, T0 - 24 * HOUR);
    const t0 = Date.now();
    const p = new XmltvWindowParser({ from: T0, to: T0 + 4 * HOUR, maxPerChannel: 3 });
    for (let i = 0; i < xml.length; i += 1024 * 1024) p.push(xml.slice(i, i + 1024 * 1024));
    const guide = p.end();
    const ms = Date.now() - t0;
    expect(p.programmesRead).toBe(96_000);
    expect(Object.keys(guide.channels)).toHaveLength(2000);
    expect(guide.channels['ch1999.example']).toHaveLength(3);
    expect(ms).toBeLessThan(5000);
  });
});

describe('matching by name', () => {
  it('keeps a channel found by its display name', () => {
    const keep = new Set(['ch0.example']);
    const p = new XmltvWindowParser({ from: T0, to: T0 + HOUR, keep, matchNames: new Set(['channel 2']) });
    p.push(bigXmltv(3, 1, T0));
    expect(Object.keys(p.end().channels).sort()).toEqual(['ch0.example', 'ch2.example']);
  });
});
