import { popInStep, turnedOn } from '../pop-in';

describe('popInStep', () => {
  it('never plays on the first render', () => {
    expect(popInStep(null, { scope: 'a', value: true }, turnedOn)).toBe('none');
  });
  it('plays when the value enters the state', () => {
    expect(popInStep({ scope: 'a', value: false }, { scope: 'a', value: true }, turnedOn)).toBe('play');
  });
  it('rests when the value leaves the state', () => {
    expect(popInStep({ scope: 'a', value: true }, { scope: 'a', value: false }, turnedOn)).toBe('rest');
  });
  it('does nothing when the value stays', () => {
    expect(popInStep({ scope: 'a', value: true }, { scope: 'a', value: true }, turnedOn)).toBe('none');
  });
  it('only rests when the scope changes (a recycled cell)', () => {
    expect(popInStep({ scope: 'a', value: false }, { scope: 'b', value: true }, turnedOn)).toBe('rest');
  });
});

describe('turnedOn', () => {
  it('counts only false to true', () => {
    expect(turnedOn(false, true)).toBe(true);
    expect(turnedOn(true, false)).toBe(false);
    expect(turnedOn(undefined, true)).toBe(false);
    expect(turnedOn(false, undefined)).toBe(false);
  });
});
