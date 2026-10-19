import { assetUrl, localPath } from '../desktop';

describe('desktop local URLs', () => {
  it('turns a folder into an asset URL and back into a path', () => {
    const dir = '/Users/x/Library/Application Support/app/';
    const url = assetUrl(dir);
    expect(url).toBe('asset://localhost/%2FUsers%2Fx%2FLibrary%2FApplication%20Support%2Fapp');
    expect(localPath(`${url}/downloads/a/media.mkv`)).toBe('/Users/x/Library/Application Support/app/downloads/a/media.mkv');
  });

  it('reads file URLs and leaves server URLs as they are', () => {
    expect(localPath('file:///data/My%20Movies/a.mkv')).toBe('/data/My Movies/a.mkv');
    expect(localPath('https://s/Videos/1/stream?static=true')).toBe('https://s/Videos/1/stream?static=true');
  });
});
