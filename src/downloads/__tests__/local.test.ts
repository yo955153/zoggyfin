import { chooseMedia, fileUri, localImageUri, localMediaUri } from '../local';
import { rec } from '../test-utils/fixtures';

const DOCS = 'file:///data/Documents/';

describe('local-first media choice', () => {
  it('joins paths into a file URI', () => {
    expect(fileUri(DOCS, 'downloads/a/media.mp3')).toBe('file:///data/Documents/downloads/a/media.mp3');
    expect(fileUri('/data/Documents', '/downloads/a')).toBe('file:///data/Documents/downloads/a');
  });

  it('plays a completed download from the device and never builds the server URL', () => {
    const r = rec({ state: 'completed', mediaFile: 'media.mp3' });
    const remote = jest.fn(() => 'http://server/stream');
    const choice = chooseMedia(r, DOCS, 'server-1', remote);
    expect(choice).toEqual({ kind: 'local', uri: 'file:///data/Documents/downloads/item-1/media.mp3', record: r });
    expect(remote).not.toHaveBeenCalled();
  });

  it('streams when the download is not finished, missing, or from another server', () => {
    const remote = () => 'http://server/stream';
    expect(chooseMedia(rec({ state: 'downloading', mediaFile: 'media.mp3' }), DOCS, 'server-1', remote).kind).toBe('remote');
    expect(chooseMedia(null, DOCS, 'server-1', remote)).toEqual({ kind: 'remote', uri: 'http://server/stream' });
    expect(chooseMedia(rec({ state: 'completed', mediaFile: 'media.mp3' }), DOCS, 'server-2', remote).kind).toBe('remote');
    expect(chooseMedia(rec({ state: 'completed', mediaFile: '' }), DOCS, 'server-1', remote).kind).toBe('remote');
    expect(chooseMedia(rec({ state: 'completed', mediaFile: 'media.mp3' }), null, 'server-1', remote).kind).toBe('remote');
  });

  it('returns null for an unfinished download', () => {
    expect(localMediaUri(rec({ state: 'paused', mediaFile: 'media.mp3' }), DOCS)).toBeNull();
  });

  it('picks the local image for a variant, with a fallback', () => {
    const r = rec({ images: { primary: 'primary.jpg', backdrop: 'backdrop.jpg' } });
    expect(localImageUri(r, DOCS, 'poster')).toBe('file:///data/Documents/downloads/item-1/primary.jpg');
    expect(localImageUri(r, DOCS, 'backdrop')).toBe('file:///data/Documents/downloads/item-1/backdrop.jpg');
    expect(localImageUri(rec({ images: { backdrop: 'backdrop.jpg' } }), DOCS, 'square')).toBe('file:///data/Documents/downloads/item-1/backdrop.jpg');
    expect(localImageUri(rec(), DOCS, 'square')).toBeNull();
  });
});
