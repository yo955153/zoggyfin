import { Stack } from 'expo-router';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { useSearch } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { Button } from '@/components/button';
import { Chip, chipRowTV } from '@/components/chip';
import { Icon } from '@/components/icon';
import { ItemImage } from '@/components/item-image';
import { ItemRow, RowHeader } from '@/components/item-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { shapeFor } from '@/components/tile';
import { Touchable } from '@/components/touchable';
import { isNetworkError, searchDownloads } from '@/downloads';
import { useDownloadsStore } from '@/downloads/store';
import { TrackRow } from '@/features/detail/rows';
import { OfflineBanner } from '@/features/offline/offline-banner';
import { useServerNames } from '@/features/servers/use-server-names';
import {
  filterSections,
  groupSearchResults,
  pushRecentSearch,
  SEARCH_FILTERS,
  type SearchFilter,
  topResult,
} from '@/features/search/group-results';
import { formatDuration } from '@/lib/format';
import { useOpenItem } from '@/lib/navigation';
import { useRootScreenOptions } from '@/lib/stack-options';
import { useOffline } from '@/lib/online';
import { useDebounced } from '@/lib/use-debounced';
import { isTV } from '@/platform/tv';
import { usePlayer } from '@/player';
import { readJson, writeJson } from '@/storage/json';
import { createStyles,
  type AppTheme,
  font,
  iconSize,
  radius,
  scaled,
  scriptStyle,
  sizes,
  spacing,
  type,
  useLayout,
  useStyles,
  useTheme,
  webInput,
} from '@/theme';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';

const RECENT_KEY = 'search.recent';
const PLACEHOLDER = 'Movies, shows, music, people';

export default function SearchScreen() {
  const s = useStyles(makeStyles);
  const bottomPad = useTabBottomPadding();
  const { c } = useTheme();
  const l = useLayout();
  const root = useRootScreenOptions();
  const [text, setText] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const term = useDebounced(text.trim(), sizes.searchDebounce);
  const q = useSearch(term);
  const offline = useOffline();
  const records = useDownloadsStore((st) => st.records);
  const nameOf = useServerNames();
  // With downloads from more than one server, each local result names its server.
  const serverOf = useMemo(() => {
    const servers = new Set(Object.values(records).map((r) => r.serverId));
    return servers.size > 1 ? (it: BaseItemDto) => (it.Id && records[it.Id] ? nameOf(records[it.Id].serverId) : undefined) : null;
  }, [records, nameOf]);
  // Offline (or the server cannot be reached): search what is on this device.
  const localOnly = offline || (!!q.error && !q.data && isNetworkError(q.error));
  const localResults = useMemo(() => (localOnly ? searchDownloads(records, term) : []), [localOnly, records, term]);
  const results = localOnly ? localResults : q.data;
  const all = useMemo(() => groupSearchResults(results ?? []), [results]);
  const sections = useMemo(() => filterSections(all, filter), [all, filter]);
  const top = filter === 'all' ? topResult(sections) : null;
  const [recentVersion, setRecentVersion] = useState(0);
  const searchRef = useRef<SearchBarCommands>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const player = usePlayer();

  // Remember a search once it returns results.
  const hasResults = !localOnly && !!q.data?.length;
  useEffect(() => {
    if (term.length >= 2 && hasResults) {
      writeJson(RECENT_KEY, pushRecentSearch(readJson<string[]>(RECENT_KEY, []), term));
    }
  }, [term, hasResults]);

  const active = term.length >= 2;
  // Read when the recent list is on screen; it changes only between searches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recent = useMemo(() => readJson<string[]>(RECENT_KEY, []), [active, recentVersion]);

  const applyRecent = (r: string) => {
    setText(r);
    searchRef.current?.setText(r);
  };

  const ownField = Platform.OS === 'web' || isTV;

  return (
    <>
      <Stack.Screen
        options={{
          ...root,
          title: 'Search',
          headerSearchBarOptions: ownField
            ? undefined
            : {
                ref: searchRef,
                placeholder: PLACEHOLDER,
                autoCapitalize: 'none',
                hideWhenScrolling: false,
                tintColor: c.accent,
                textColor: c.text,
                onChangeText: (e) => setText(e.nativeEvent.text),
                onCancelButtonPress: () => setText(''),
              },
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        style={s.page}
        contentContainerStyle={[s.content, { paddingBottom: bottomPad }]}>
        {ownField ? (
          <View style={[s.fieldRow, { paddingHorizontal: l.gutter }]}>
            <View style={s.field}>
              <Icon name="magnifyingglass" size={scaled(iconSize.sm)} color={c.text3} />
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={PLACEHOLDER}
                placeholderTextColor={c.text3}
                selectionColor={c.accent}
                autoCapitalize="none"
                autoCorrect={false}
                autoFocus={!isTV}
                style={s.input}
                accessibilityLabel="Search"
                returnKeyType="search"
              />
              {text ? (
                <Touchable onPress={() => setText('')} hitSlop={10} radius={10} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Icon name="xmark.circle.fill" size={scaled(iconSize.sm)} color={c.text3} />
                </Touchable>
              ) : null}
            </View>
            {text ? (
              <Touchable
                onPress={() => {
                  setText('');
                  inputRef.current?.blur();
                }}
                radius={8}
                accessibilityRole="button"
                accessibilityLabel="Cancel">
                <Text style={s.cancel}>Cancel</Text>
              </Touchable>
            ) : null}
          </View>
        ) : null}

        <OfflineBanner />
        {active ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.chips}
            contentContainerStyle={[s.chipsContent, { paddingHorizontal: l.gutter }, chipRowTV()]}>
            {SEARCH_FILTERS.map((f) => (
              <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
            ))}
          </ScrollView>
        ) : null}

        {!active ? (
          recent.length ? (
            <View style={s.recent}>
              <RowHeader title="Recent searches" />
              <View style={[s.recentList, { marginHorizontal: l.gutter }]}>
                {recent.map((r, i) => (
                  <Touchable
                    key={r}
                    kind="row"
                    onPress={() => applyRecent(r)}
                    accessibilityRole="button"
                    accessibilityLabel={`Search for ${r}`}
                    style={({ pressed, hovered, focused }) => [s.recentRow, (pressed || hovered || focused) && s.rowActive]}>
                    <Icon name="clock.arrow.circlepath" size={scaled(iconSize.sm)} color={c.text3} />
                    <View style={[s.recentBody, i < recent.length - 1 && s.line]}>
                      <Text style={[s.recentText, scriptStyle(r, s.recentText)]} numberOfLines={1}>
                        {r}
                      </Text>
                    </View>
                  </Touchable>
                ))}
              </View>
              <Button
                title="Clear recent searches"
                variant="text"
                onPress={() => {
                  writeJson(RECENT_KEY, []);
                  setRecentVersion((v) => v + 1);
                }}
                containerStyle={{ marginLeft: l.gutter - spacing.sm, alignSelf: 'flex-start' }}
              />
            </View>
          ) : (
            <EmptyState icon="magnifyingglass" title="Search your server" message="Find movies, shows, episodes, albums, songs, artists and people." />
          )
        ) : !localOnly && q.isPending ? (
          <LoadingState />
        ) : !localOnly && q.error && !q.data ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : sections.length === 0 ? (
          <EmptyState
            icon="magnifyingglass"
            title={`No results for “${term}”`}
            message={
              localOnly
                ? 'The server cannot be reached, so only downloads are searched.'
                : filter === 'all'
                  ? 'Check the spelling or try fewer words.'
                  : 'Check the spelling or choose another filter.'
            }
          />
        ) : (
          <View style={q.isFetching && !localOnly ? s.stale : undefined}>
            {top ? <TopResult item={top} onPlay={() => player.play({ item: top })} /> : null}
            {sections.map((sec) =>
              sec.key === 'songs' ? (
                <View key={sec.key} style={{ marginTop: l.sectionGap }}>
                  <RowHeader title={sec.title} />
                  {sec.items.slice(0, 8).map((song, i, list) => (
                    <TrackRow
                      key={song.Id ?? i}
                      item={song}
                      index={i}
                      showArt
                      note={localOnly ? serverOf?.(song) : undefined}
                      last={i === list.length - 1}
                      onPress={(it) => player.play({ item: it })}
                    />
                  ))}
                </View>
              ) : (
                <ItemRow
                  key={sec.key}
                  title={sec.title}
                  items={sec.items}
                  shape={sec.items[0] ? shapeFor(sec.items[0]) : 'poster'}
                  tileSubtitle={localOnly && serverOf ? serverOf : undefined}
                />
              ),
            )}
            {localOnly ? <Text style={[s.localNote, { paddingHorizontal: l.gutter }]}>Showing downloads only. The server cannot be reached.</Text> : null}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const PLAYABLE = new Set(['Movie', 'Episode', 'Video', 'MusicVideo', 'Audio', 'MusicAlbum', 'Series', 'Playlist']);
const TYPE_LABEL: Record<string, string> = {
  Movie: 'Movie',
  Series: 'Show',
  Episode: 'Episode',
  MusicAlbum: 'Album',
  Audio: 'Song',
  MusicArtist: 'Artist',
  Person: 'Person',
  Playlist: 'Playlist',
  BoxSet: 'Collection',
  Video: 'Video',
};

/** The top result card: art, title, facts and a Play or Resume button. */
function TopResult({ item, onPlay }: { item: BaseItemDto; onPlay: () => void }) {
  const s = useStyles(makeStyles);
  const l = useLayout();
  const open = useOpenItem();
  const shape = shapeFor(item);
  const artWidth = scaled(shape === 'thumb' ? 112 : 64);
  const aspect = shape === 'poster' ? 2 / 3 : shape === 'thumb' ? 16 / 9 : 1;
  const facts = [TYPE_LABEL[item.Type ?? ''], item.ProductionYear ? String(item.ProductionYear) : null, formatDuration(item.RunTimeTicks)]
    .filter(Boolean)
    .join(' · ');
  const resume = !!item.UserData?.PlaybackPositionTicks;
  return (
    <View style={{ marginTop: spacing.lg, paddingHorizontal: l.gutter }}>
      <Text style={s.topHeader} accessibilityRole="header">
        Top result
      </Text>
      {/* The card press area and the Play button are siblings: a button must not be inside a button (web). */}
      <View>
        <Touchable
          kind="plain"
          radius={radius.lg}
          onPress={() => open(item)}
          accessibilityRole="button"
          accessibilityLabel={[item.Name, facts].filter(Boolean).join(', ')}
          containerStyle={StyleSheet.absoluteFill}
          style={({ pressed, hovered }) => [s.topCardBg, (pressed || hovered) && s.topCardBgActive]}
        />
        <View style={s.topCard} pointerEvents="box-none">
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ItemImage item={item} variant={shape === 'thumb' ? 'landscape' : shape === 'poster' ? 'poster' : 'square'} width={artWidth} aspectRatio={aspect} rounded={radius.sm} circle={shape === 'circle'} hideArtTitle />
          </View>
          <View style={s.topBody} pointerEvents="box-none">
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.topText}>
              <Text style={[s.topTitle, scriptStyle(item.Name, s.topTitle)]} numberOfLines={2}>
                {item.Name}
              </Text>
              {facts ? <Text style={s.topMeta}>{facts}</Text> : null}
            </View>
            {PLAYABLE.has(item.Type ?? '') ? (
              <Button title={resume ? 'Resume' : 'Play'} icon="play.fill" variant="small" onPress={onPlay} containerStyle={s.topButton} />
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { backgroundColor: c.bg },
  content: { paddingBottom: spacing.huge * 2 },
  stale: { opacity: 0.6 },
  localNote: { ...font(type.footnote), color: c.text2, marginTop: spacing.xl },
  fieldRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, marginTop: spacing.sm },
  field: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: scaled(sizes.webSearchHeight),
    backgroundColor: c.surface2,
    borderRadius: radius.md + 2,
    borderCurve: 'continuous' as const,
  },
  input: { ...font(type.body), ...webInput, color: c.text, flex: 1, height: '100%' as const },
  cancel: { ...font(type.body), color: c.accent },
  chips: { flexGrow: 0, marginTop: spacing.md },
  chipsContent: { gap: spacing.sm },
  recent: { marginTop: spacing.xxl },
  recentList: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const },
  recentRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingLeft: spacing.lg },
  rowActive: { backgroundColor: c.surface3 },
  recentBody: { flex: 1, minHeight: scaled(sizes.rowMin), justifyContent: 'center' as const, paddingRight: spacing.lg },
  line: { borderBottomWidth: sizes.hairline, borderBottomColor: c.separator },
  recentText: { ...font(type.body), color: c.text },
  topHeader: { ...font(type.title3), color: c.text, marginBottom: 10 },
  topCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    padding: spacing.md,
  },
  topCardBg: { flex: 1, backgroundColor: c.surface, borderRadius: radius.lg, borderCurve: 'continuous' as const },
  topCardBgActive: { backgroundColor: c.surface2 },
  topBody: { flex: 1 },
  topText: { gap: 2 },
  topTitle: { ...font(type.headline), color: c.text },
  topMeta: { ...font(type.footnote), color: c.text2 },
  topButton: { alignSelf: 'flex-start' as const, marginTop: spacing.sm },
}));
