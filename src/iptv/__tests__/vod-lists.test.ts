import {
  continueWatching,
  EMPTY_VOD_LISTS,
  favouritesOf,
  isFinished,
  isVodFavourite,
  MAX_POSITIONS,
  playedFractionOf,
  positionKey,
  resumeAt,
  seriesTarget,
  toggleVodFavourite,
  withPosition,
} from '../vod-lists';
import type { Season, VodLists } from '../vod-types';

const film = (id: string, position: number, duration = 6000) => ({ kind: 'film' as const, id, position, duration, title: `Film ${id}` });
const ep = (id: string, position: number, duration = 2400) => ({ kind: 'episode' as const, id, seriesId: 's1', position, duration, title: `Ep ${id}`, seriesName: 'Show' });

const seasons: Season[] = [
  { number: 1, name: 'Season 1', episodes: [{ id: 'e1', season: 1, number: 1, title: 'One' }, { id: 'e2', season: 1, number: 2, title: 'Two' }] },
  { number: 2, name: 'Season 2', episodes: [{ id: 'e3', season: 2, number: 1, title: 'Three' }] },
];

describe('IPTV film and series lists', () => {
  it('adds favourites first and removes them again', () => {
    let l = toggleVodFavourite(EMPTY_VOD_LISTS, { kind: 'film', id: '1', name: 'A' }, 1);
    l = toggleVodFavourite(l, { kind: 'series', id: '1', name: 'B', poster: 'https://img.example.com/b.jpg' }, 2);
    expect(favouritesOf(l, 'film').map((f) => f.name)).toEqual(['A']);
    expect(l.favourites.map((f) => f.kind)).toEqual(['series', 'film']);
    expect(isVodFavourite(l, 'series', '1')).toBe(true);
    l = toggleVodFavourite(l, { kind: 'film', id: '1', name: 'A' }, 3);
    expect(isVodFavourite(l, 'film', '1')).toBe(false);
    expect(isVodFavourite(l, 'series', '1')).toBe(true);
  });

  it('knows when a title is finished', () => {
    expect(isFinished(5520, 6000)).toBe(true);
    expect(isFinished(5000, 6000)).toBe(false);
    expect(isFinished(5890, 6000)).toBe(true);
    expect(isFinished(500, 0)).toBe(false);
    // A short clip: only the fraction counts.
    expect(isFinished(200, 300)).toBe(false);
  });

  it('saves positions, drops short ones and starts finished titles over', () => {
    let l = withPosition(EMPTY_VOD_LISTS, film('1', 10), 1);
    expect(l).toBe(EMPTY_VOD_LISTS);
    l = withPosition(l, film('1', 600), 2);
    expect(resumeAt(l, 'film', '1')).toBe(600);
    expect(l.positions[positionKey('film', '1')]).toMatchObject({ position: 600, finished: false, at: 2 });
    // The same position again changes nothing.
    expect(withPosition(l, film('1', 600.4), 3)).toBe(l);
    // Started over and left early: the old position goes.
    expect(resumeAt(withPosition(l, film('1', 12), 4), 'film', '1')).toBe(0);
    const done = withPosition(l, film('1', 5900), 5);
    expect(done.positions['film:1']).toMatchObject({ finished: true, position: 0 });
    expect(resumeAt(done, 'film', '1')).toBe(0);
    // A short position after a finish keeps the finish (the next episode logic needs it).
    expect(withPosition(done, film('1', 3), 6)).toBe(done);
    expect(withPosition(EMPTY_VOD_LISTS, film('2', 0, 0), 7, true).positions['film:2'].finished).toBe(true);
  });

  it('keeps at most the newest positions', () => {
    let l: VodLists = EMPTY_VOD_LISTS;
    for (let i = 0; i < MAX_POSITIONS + 5; i++) l = withPosition(l, film(String(i), 100), i);
    expect(Object.keys(l.positions)).toHaveLength(MAX_POSITIONS);
    expect(l.positions['film:0']).toBeUndefined();
    expect(l.positions[`film:${MAX_POSITIONS + 4}`]).toBeDefined();
  });

  it('lists unfinished titles newest first, one episode per series', () => {
    let l = withPosition(EMPTY_VOD_LISTS, film('1', 600), 1);
    l = withPosition(l, ep('e1', 300), 2);
    l = withPosition(l, ep('e2', 400), 3);
    l = withPosition(l, film('2', 5900), 4);
    expect(continueWatching(l).map((p) => p.id)).toEqual(['e2', '1']);
    expect(continueWatching(l, 'film').map((p) => p.id)).toEqual(['1']);
    expect(continueWatching(l, 'episode').map((p) => p.id)).toEqual(['e2']);
    expect(playedFractionOf(l.positions['film:1'])).toBeCloseTo(0.1);
    expect(playedFractionOf(l.positions['film:2'])).toBeNull();
  });

  it('picks what Play does for a series', () => {
    expect(seriesTarget(seasons, EMPTY_VOD_LISTS)).toMatchObject({ episode: { id: 'e1' }, start: 0, label: 'Play S1 E1' });
    let l = withPosition(EMPTY_VOD_LISTS, ep('e2', 300), 1);
    expect(seriesTarget(seasons, l)).toMatchObject({ episode: { id: 'e2' }, start: 300, label: 'Resume S1 E2' });
    l = withPosition(l, ep('e2', 2390), 2);
    expect(seriesTarget(seasons, l)).toMatchObject({ episode: { id: 'e3' }, start: 0, label: 'Play S2 E1' });
    l = withPosition(l, ep('e3', 2390), 3);
    expect(seriesTarget(seasons, l)).toMatchObject({ episode: { id: 'e1' }, label: 'Play S1 E1' });
    expect(seriesTarget([], l)).toBeNull();
  });
});
