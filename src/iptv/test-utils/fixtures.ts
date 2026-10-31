/**
 * Test playlists and guides. Generic names and example.com addresses only:
 * no real provider, no real credentials.
 */

/** A small playlist with the odd cases real lists have. */
export const SAMPLE_M3U = [
  '﻿#EXTM3U url-tvg="https://epg.example.com/guide.xml.gz,https://epg.example.com/extra.xml" x-tvg-url="https://epg.example.com/guide.xml.gz"',
  '#EXTINF:-1 tvg-id="news.example" tvg-name="Example News" tvg-logo="https://img.example.com/news.png" group-title="News" tvg-chno="101",Example News HD',
  'http://stream.example.com/live/jane/secret/1001.ts',
  '#EXTINF:-1 tvg-id=\'sport.example\' tvg-logo=https://img.example.com/sport.png group-title=\'Sport, Live\',Sport One',
  '#EXTVLCOPT:http-user-agent=ExampleAgent/1.0',
  'http://stream.example.com/jane/secret/1002',
  '#EXTINF:-1 group-title="Kids" catchup="default" catchup-days="3",Cartoon "Fun" Time, Extra',
  'https://cdn.example.com/kids/index.m3u8?token=abc',
  '#EXTINF:-1,No Attributes',
  '#EXTGRP:Music',
  'http://stream.example.com/music.ts',
  '#EXTINF:-1 tvg-name="Only TVG Name" group-title="",',
  'http://stream.example.com/x.ts',
  '#EXTINF:-1 tvg-name="Only TVG Name",',
  'http://stream.example.com/y.ts',
  'http://stream.example.com/orphan%20channel.ts',
  '',
].join('\r\n');

/** A playlist with `count` channels in `groups` groups. */
export function bigM3u(count: number, groups = 40): string {
  const lines = ['#EXTM3U'];
  for (let i = 0; i < count; i++) {
    const g = `Group ${i % groups}`;
    lines.push(`#EXTINF:-1 tvg-id="ch${i}.example" tvg-name="Channel ${i}" tvg-logo="https://img.example.com/${i}.png" group-title="${g}",Channel ${i} HD`);
    lines.push(`http://stream.example.com/live/user/pass/${i}.ts`);
  }
  return `${lines.join('\n')}\n`;
}

/** XMLTV time text for ms (UTC, with an offset). */
export function xmltvTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`;
}

/** A guide: `channels` channels, each with hour-long programmes from `start` for `hours` hours. */
export function bigXmltv(channels: number, hours: number, start: number): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE tv SYSTEM "xmltv.dtd">', '<tv generator-info-name="test">'];
  for (let c = 0; c < channels; c++) {
    out.push(`  <channel id="ch${c}.example"><display-name lang="en">Channel ${c}</display-name><icon src="https://img.example.com/${c}.png"/></channel>`);
  }
  for (let c = 0; c < channels; c++) {
    for (let h = 0; h < hours; h++) {
      const s = start + h * 3_600_000;
      out.push(
        `  <programme start="${xmltvTime(s)}" stop="${xmltvTime(s + 3_600_000)}" channel="ch${c}.example"><title lang="en">Show ${h} &amp; Friends</title><desc lang="en">Episode ${h} of channel ${c}.</desc></programme>`,
      );
    }
  }
  out.push('</tv>');
  return out.join('\n');
}

/** Splits text into chunks of `size` characters (a parser must cope with any split). */
export async function* inChunks(text: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

/** Base64 of the UTF-8 bytes of a string (how Xtream sends guide text). */
export function toBase64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}
