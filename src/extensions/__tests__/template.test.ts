import { namesIn, render, renderJson, usesName } from '../template';

const ctx = {
  item: { id: 'abc', name: 'A/B & C', path: '/media/x.mp4' },
  input: { folder: 'videos' },
  settings: { loud: true, n: 3 },
  share: { url: 'https://youtu.be/1' },
};

describe('templates', () => {
  it('fills names and gives "" for unknown ones', () => {
    expect(render('{{item.id}}-{{ input.folder }}-{{item.nope}}-{{other.x}}', ctx)).toBe('abc-videos--');
  });
  it('encodes values when asked (URL paths)', () => {
    expect(render('/items/{{item.name}}', ctx, encodeURIComponent)).toBe('/items/A%2FB%20%26%20C');
  });
  it('does not run expressions or reach the prototype', () => {
    expect(render('{{item.constructor}}', ctx)).toBe('');
    expect(render('{{item.id + 1}}', ctx)).toBe('{{item.id + 1}}');
  });
  it('fills JSON and keeps the type of a whole-token toggle', () => {
    expect(renderJson({ a: '{{settings.loud}}', b: 'x{{settings.loud}}', c: ['{{share.url}}'], d: 5, e: '{{settings.n}}' }, ctx)).toEqual({
      a: true,
      b: 'xtrue',
      c: ['https://youtu.be/1'],
      d: 5,
      e: 3,
    });
  });
  it('lists the names a template uses', () => {
    expect(namesIn('{{item.id}} {{input.a}}')).toEqual(['item.id', 'input.a']);
    expect(usesName({ body: { p: '{{item.path}}' } }, 'item.path')).toBe(true);
    expect(usesName({ body: { p: '{{item.id}}' } }, 'item.path')).toBe(false);
  });
});
