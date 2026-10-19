import { findLink, manifestCandidates, matchesHosts, matchesWhen, OriginError, resolveOnOrigin } from '../match';

describe('matchesWhen', () => {
  it('matches all items with no filter', () => {
    expect(matchesWhen(undefined, { type: 'Movie' })).toBe(true);
    expect(matchesWhen({}, {})).toBe(true);
  });
  it('checks types and media types', () => {
    expect(matchesWhen({ types: ['Movie', 'Video'] }, { type: 'Video' })).toBe(true);
    expect(matchesWhen({ types: ['Movie'] }, { type: 'Episode' })).toBe(false);
    expect(matchesWhen({ mediaTypes: ['Audio'] }, { mediaType: 'Video' })).toBe(false);
  });
  it('compares library names without case and fails when the library is unknown', () => {
    expect(matchesWhen({ libraries: ['YouTube'] }, { libraryName: 'youtube' })).toBe(true);
    expect(matchesWhen({ libraries: ['YouTube'] }, { libraryName: null })).toBe(false);
  });
  it('checks path prefixes and fails with no path', () => {
    expect(matchesWhen({ pathPrefixes: ['/media/videos/'] }, { path: '/media/videos/a.mp4' })).toBe(true);
    expect(matchesWhen({ pathPrefixes: ['/media/videos/'] }, { path: '/media/music/a.mp3' })).toBe(false);
    expect(matchesWhen({ pathPrefixes: ['/media/'] }, {})).toBe(false);
  });
  it('needs every given field', () => {
    expect(matchesWhen({ types: ['Movie'], libraries: ['A'] }, { type: 'Movie', libraryName: 'B' })).toBe(false);
  });
});

describe('links', () => {
  it('finds the first link in shared text', () => {
    expect(findLink('Look at this https://youtu.be/abc?t=1, nice')).toBe('https://youtu.be/abc?t=1');
    expect(findLink('no link here')).toBeNull();
  });
  it('matches hosts and their subdomains', () => {
    expect(matchesHosts('https://www.youtube.com/watch?v=1', ['youtube.com'])).toBe(true);
    expect(matchesHosts('https://youtu.be/1', ['*.youtu.be', 'youtu.be'])).toBe(true);
    expect(matchesHosts('https://notyoutube.com/x', ['youtube.com'])).toBe(false);
    expect(matchesHosts('https://any.site/x', undefined)).toBe(true);
    expect(matchesHosts('ftp://youtube.com/x', [])).toBe(false);
  });
});

describe('resolveOnOrigin', () => {
  const base = 'http://192.0.2.10:3000';
  it('resolves paths under the base', () => {
    expect(resolveOnOrigin(base, '/api/x').toString()).toBe('http://192.0.2.10:3000/api/x');
    expect(resolveOnOrigin(`${base}/ext/`, '/api/x').toString()).toBe('http://192.0.2.10:3000/ext/api/x');
  });
  it('accepts a full URL on the same origin', () => {
    expect(resolveOnOrigin(base, 'http://192.0.2.10:3000/a?b=1').toString()).toBe('http://192.0.2.10:3000/a?b=1');
  });
  it('refuses another host, port or scheme', () => {
    expect(() => resolveOnOrigin(base, 'http://evil.example/a')).toThrow(OriginError);
    expect(() => resolveOnOrigin(base, 'http://192.0.2.10:3001/a')).toThrow(OriginError);
    expect(() => resolveOnOrigin(base, 'https://192.0.2.10:3000/a')).toThrow(OriginError);
    expect(() => resolveOnOrigin(base, '//evil.example/a')).toThrow(OriginError);
  });
  it('keeps a path with ".." on the origin', () => {
    expect(resolveOnOrigin(base, '/../../etc').origin).toBe('http://192.0.2.10:3000');
  });
});

describe('manifestCandidates', () => {
  it('uses a .json URL as it is', () => {
    expect(manifestCandidates('http://h:1/x/zoggyfin-extension.json')).toEqual(['http://h:1/x/zoggyfin-extension.json']);
  });
  it('turns a site address into the manifest URL', () => {
    expect(manifestCandidates('192.0.2.10:3001')[0]).toBe('http://192.0.2.10:3001/zoggyfin-extension.json');
    expect(manifestCandidates('https://ext.example/app/')[0]).toBe('https://ext.example/app/zoggyfin-extension.json');
  });
  it('gives nothing for empty or broken input', () => {
    expect(manifestCandidates('  ')).toEqual([]);
    expect(manifestCandidates('http://')).toEqual([]);
  });
});
