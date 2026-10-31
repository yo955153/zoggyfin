/**
 * The Live TV page (design system §7.21).
 *
 * TV and wide windows: a browse column at the leading edge (Search,
 * Favourites, Recently watched, All channels, other sections, the provider's
 * groups, Providers), the channel list, and on TV the focused channel's
 * details beside the list (TiviMate style). On TV, Left from the column
 * opens the side menu.
 * Narrow windows: the search field at the top, the lists and groups as chips,
 * and the channel list.
 *
 * Search is one step away everywhere: the Search entry at the top of the
 * column (TV: it opens the field and the keyboard at once), the Search button
 * in the TV header, and the field on phones. Results follow every key press
 * and match the channel name and number; a search used to play a channel is
 * kept as a recent search.
 */
import { router, Stack } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip, chipRowTV } from '@/components/chip';
import { Icon, type IconName } from '@/components/icon';
import { LoadingState } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { focusView } from '@/features/tv/focus';
import { useTvBack } from '@/features/tv/use-tv-back';
import { useTvRemote } from '@/features/tv/use-tv-remote';
import {
  browseEntries,
  type Channel,
  FAVOURITES_GROUP,
  iptv,
  resolveGroup,
  SEARCH_ENTRY,
  useActiveProviderId,
  useChannelLists,
  useChannels,
  useChannelView,
  useMinute,
  usePlayChannel,
  useProviders,
  useRecentSearches,
  useVodKinds,
} from '@/iptv';
import { useRootScreenOptions } from '@/lib/stack-options';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { toast } from '@/lib/toast';
import { useDebounced } from '@/lib/use-debounced';
import { features, isNativeTV, isTV } from '@/platform/tv';
import { usePlayerStore } from '@/player';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, tvFocusBleed, type, useLayout, useStyles, useTheme, webInput } from '@/theme';

import { BrowseColumn } from './browse-column';
import { ChannelDetails } from './channel-details';
import { CHANNEL_ROW_HEIGHT, ChannelRow, HEART_TV } from './channel-row';
import { providerFormHref, providersHref, useLiveGroup } from './nav';
import { liveTvSections, type LiveTvSection } from './sections';

const COLUMN_WIDTH = scaled(isTV ? 200 : 220);
const DETAILS_WIDTH = scaled(isTV ? 290 : 320);
const COLUMN_GAP = spacing.lg;

const VIEWABILITY = { itemVisiblePercentThreshold: 30, minimumViewTime: 250 };

export function LiveTvScreen() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const root = useRootScreenOptions();
  const bottomPad = useTabBottomPadding(isTV ? spacing.xxl : undefined);
  const group = useLiveGroup();
  const providers = useProviders();
  const providerId = useActiveProviderId();
  const provider = providers.find((p) => p.id === providerId) ?? null;
  const data = useChannels(providerId);
  const lists = useChannelLists(providerId);
  const recentSearches = useRecentSearches(providerId);

  // The group picked for a provider (another provider starts on its own default group).
  const [pick, setPick] = useState<{ providerId: string | null; key: string } | null>(null);
  const picked = pick && pick.providerId === providerId ? pick.key : null;
  const setPicked = useCallback((key: string) => setPick({ providerId, key }), [providerId]);

  // Search: the field text, and (TV and wide windows) the open Search entry.
  const [text, setText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  const query = useDebounced(text.trim(), 120);
  const searching = searchOpen || !!text.trim();

  const wide = l.tv || l.bp !== 'compact';
  // TV: the focused channel's details beside the list.
  const details = l.tv;
  const kinds = useVodKinds(providerId);
  const sections = useMemo(() => liveTvSections.filter((x) => x.available(kinds)), [kinds]);

  const base = useChannelView(providerId, '', '');
  const groupKey = resolveGroup(base.groups, picked);
  const view = useChannelView(providerId, groupKey, searching ? query : '');
  const entries = useMemo(() => browseEntries(base.groups, sections), [base.groups, sections]);
  const channels = searching && !query ? EMPTY : view.channels;

  const now = useMinute();
  const play = usePlayChannel();
  const playingId = usePlayerStore((st) => (st.now?.live && st.now.live.source.providerId === providerId ? (st.now.live.channels[st.now.live.index]?.id ?? null) : null));
  const favourites = useMemo(() => new Set(lists.favourites), [lists.favourites]);
  // A number column only when the provider numbers its channels.
  const numbered = useMemo(() => data.channels.some((ch) => ch.number !== undefined), [data.channels]);

  const toggle = useCallback(
    (ch: Channel) => {
      if (!providerId) return;
      // The list stays where it is: the first favourite does not switch the page to Favourites.
      if (!picked) setPicked(groupKey);
      const on = iptv.toggleFavourite(providerId, ch.id);
      toast(on ? `${ch.name} is in Favourites` : `${ch.name} is no longer in Favourites`, { icon: on ? 'heart.fill' : 'heart' });
    },
    [providerId, picked, groupKey, setPicked],
  );
  const onPlay = useCallback(
    (ch: Channel) => {
      if (!providerId) return;
      if (searching && query) iptv.rememberSearch(providerId, query);
      play(providerId, channels, ch);
    },
    [providerId, play, channels, searching, query],
  );

  // TV: the focused row (the menu key favourites it; the details panel shows it).
  const focused = useRef<Channel | null>(null);
  const [focusedRow, setFocusedRow] = useState<{ providerId: string | null; channel: Channel } | null>(null);
  const shown = focusedRow && focusedRow.providerId === providerId ? focusedRow.channel : null;
  const onFocusRow = useCallback(
    (ch: Channel | null) => {
      if (!ch) return;
      focused.current = ch;
      setFocusedRow({ providerId, channel: ch });
    },
    [providerId],
  );
  useTvRemote(isNativeTV, (e) => {
    if (e.eventType === 'menu' && Number(e.eventKeyAction ?? -1) !== 0 && focused.current) toggle(focused.current);
  });

  // Search entry, field and Back.
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const searchEntry = useRef<ComponentRef<typeof View> | null>(null);
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // Straight into the field, and the keyboard opens. On TV a new field focuses itself
    // (autoFocus); one that is already there takes the focus here.
    field.current?.focus();
  }, []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setText('');
    field.current?.blur();
    if (isTV) setTimeout(() => focusView(searchEntry.current), 60);
  }, []);
  // TV: Back leaves the search (the keyboard closes first, by itself).
  useTvBack(isTV && searchOpen, closeSearch);
  const pickGroup = useCallback(
    (key: string) => {
      setSearchOpen(false);
      setText('');
      setPicked(key);
    },
    [setPicked],
  );
  const openSection = useCallback((x: LiveTvSection) => {
    if (providerId) router.push(x.href(group, providerId));
  }, [group, providerId]);
  const openProviders = useCallback(() => router.push(providersHref(group)), [group]);

  // Xtream: now and next load for the rows on screen.
  const providerRef = useRef(providerId);
  useEffect(() => {
    providerRef.current = providerId;
  }, [providerId]);
  // FlatList needs the same function for its whole life.
  const [onViewable] = useState(() => ({ viewableItems }: { viewableItems: { item?: Channel | null }[] }) => {
    const id = providerRef.current;
    if (id) iptv.requestNowNext(id, viewableItems.map((v) => v.item).filter((x): x is Channel => !!x));
  });

  const list = useRef<ComponentRef<typeof FlatList<Channel>>>(null);
  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [groupKey, query, providerId, searching]);

  const title = <Stack.Screen options={{ ...root, title: 'Live TV' }} />;

  if (!providers.length || !providerId) {
    return (
      <>
        {title}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[s.emptyPage, { paddingHorizontal: l.gutter, paddingBottom: bottomPad }]}>
          {isTV ? <Text style={s.tvTitle}>Live TV</Text> : null}
          <View style={s.center}>
            <View style={s.stateIcon}>
              <Icon name="tv" size={scaled(iconSize.lg)} color={c.accent} />
            </View>
            <Text style={s.emptyTitle}>Add an IPTV provider</Text>
            <Text style={s.emptyText}>
              Watch live channels from an Xtream login or an M3U playlist. Your provider gives you the details.
              {features.iptvNeedsCors ? ' In a browser, only providers that allow web pages work; the apps work with all.' : ''}
            </Text>
            <View style={s.emptyActions}>
              <Button title="Xtream login" icon="key" onPress={() => router.push(providerFormHref(group, { kind: 'xtream' }))} preferredFocus={isTV} />
              <Button title="M3U playlist" icon="list.bullet" variant="tonal" onPress={() => router.push(providerFormHref(group, { kind: 'm3u' }))} />
            </View>
          </View>
        </ScrollView>
      </>
    );
  }

  const busy = data.status === 'loading' || data.refreshing;
  const refreshButton = (
    <Touchable
      kind="icon"
      radius={radius.pill}
      disabled={busy}
      onPress={() => void iptv.refresh(providerId)}
      accessibilityRole="button"
      accessibilityLabel="Load the channel list again"
      style={s.iconButton}>
      {busy ? <ActivityIndicator color={c.text2} /> : <Icon name="arrow.clockwise" size={scaled(iconSize.sm)} color={c.text} />}
    </Touchable>
  );
  const providersButton = (
    <Touchable kind="icon" radius={radius.pill} onPress={openProviders} accessibilityRole="button" accessibilityLabel="Providers" style={s.iconButton}>
      <Icon name="gearshape" size={scaled(iconSize.sm)} color={c.text} />
    </Touchable>
  );

  const searchField = (where: 'toolbar' | 'column') => (
    <View style={[s.field, where === 'column' && s.fieldColumn, isTV && fieldFocused && s.fieldFocusedTV]}>
      <Icon name="magnifyingglass" size={scaled(iconSize.sm)} color={c.text3} />
      <TextInput
        ref={field}
        autoFocus={isTV && where === 'column'}
        value={text}
        onChangeText={setText}
        onFocus={() => {
          setFieldFocused(true);
          if (wide) setSearchOpen(true);
        }}
        onBlur={() => setFieldFocused(false)}
        placeholder={isTV ? 'Channel name or number' : 'Search channels'}
        placeholderTextColor={c.text3}
        selectionColor={c.accent}
        autoCapitalize="none"
        autoCorrect={false}
        // Android TV: keep the page in view above the keyboard, so the results show while typing.
        disableFullscreenUI
        style={s.input}
        accessibilityLabel="Search channels by name or number"
        returnKeyType="search"
      />
      {text ? (
        <Touchable onPress={() => setText('')} hitSlop={10} radius={10} accessibilityRole="button" accessibilityLabel="Clear search">
          <Icon name="xmark.circle.fill" size={scaled(iconSize.sm)} color={c.text3} />
        </Touchable>
      ) : null}
    </View>
  );

  const providerChips =
    providers.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, chipRowTV(), { paddingHorizontal: isTV ? spacing.sm : l.gutter }]}>
        {providers.map((p) => (
          <Chip key={p.id} label={p.name} icon="tv" selected={p.id === providerId} onPress={() => iptv.setActive(p.id)} />
        ))}
      </ScrollView>
    ) : null;

  // TV header: the title and the provider, then Search, reload and Providers.
  const tvHeader = (
    <View style={[s.tvHeader, { paddingHorizontal: l.gutter }]}>
      <View style={s.tvTitleBlock}>
        <Text style={s.tvTitle}>Live TV</Text>
        <Text style={s.tvSubtitle} numberOfLines={1}>
          {[provider?.name, data.channels.length ? `${data.channels.length} channels` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {providerChips}
      <Button title="Search" icon="magnifyingglass" variant="smallTonal" onPress={openSearch} />
      {refreshButton}
      {providersButton}
    </View>
  );
  const toolbar = (
    <View style={[s.toolbar, { paddingHorizontal: l.gutter }]}>
      {searchField('toolbar')}
      {refreshButton}
      {providersButton}
    </View>
  );

  // Recent searches: under the field while there is no query.
  const recentChips =
    searching && !text.trim() && recentSearches.length ? (
      <View style={s.recent}>
        <Text style={s.recentTitle}>RECENT SEARCHES</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, chipRowTV()]}>
          {recentSearches.map((q) => (
            <Chip key={q} label={q} icon="clock.arrow.circlepath" onPress={() => setText(q)} accessibilityLabel={`Search again for ${q}`} />
          ))}
          <Chip label="Clear" onPress={() => iptv.clearSearches(providerId)} accessibilityLabel="Clear recent searches" />
        </ScrollView>
      </View>
    ) : null;

  // Narrow windows: the lists, sections and groups as chips.
  const groupChips = !wide ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, { paddingHorizontal: l.gutter }]}>
      {entries.map((e) => {
        if (e.kind === 'group') {
          const icon: IconName | undefined = e.key === FAVOURITES_GROUP ? 'heart.fill' : undefined;
          return <Chip key={e.key} label={e.group.label} icon={icon} selected={!searching && e.key === groupKey} onPress={() => pickGroup(e.key)} />;
        }
        if (e.kind === 'section') {
          const x = sections.find((y) => `section:${y.key}` === e.key);
          return x ? <Chip key={e.key} label={x.label} icon={x.icon} onPress={() => openSection(x)} /> : null;
        }
        return null;
      })}
    </ScrollView>
  ) : null;

  const banner =
    data.error && data.channels.length ? (
      <View style={[s.banner, { marginHorizontal: l.gutter }]} accessibilityRole="alert">
        <Icon name="exclamationmark.triangle" size={scaled(iconSize.sm)} color={c.danger} />
        <Text style={s.bannerText} numberOfLines={3}>
          {data.error}
        </Text>
      </View>
    ) : null;

  const empty: { icon: IconName; title: string; text: string } = searching
    ? query
      ? { icon: 'magnifyingglass', title: `No channels match "${query}"`, text: 'Check the spelling, or search for the channel number.' }
      : { icon: 'magnifyingglass', title: 'Search channels', text: 'Type part of a channel name, or its number. The results show as you type.' }
    : groupKey === FAVOURITES_GROUP
      ? {
          icon: 'heart',
          title: 'No favourites yet',
          text: isTV ? 'Press the menu key on a channel, or move Right to its heart, to add it here.' : 'Tap the heart on a channel, or press and hold it, to add it here.',
        }
      : { icon: 'tv', title: 'No channels here', text: 'This group is empty. Load the channel list again to update it.' };

  // The list's width (TV: react-native-tvos puts a list in a focus guide with no size of its
  // own, so in a row it took the width of its content).
  const listWidth = wide ? Math.max(0, l.contentWidth - l.gutter * 2 - COLUMN_WIDTH - COLUMN_GAP - (details ? DETAILS_WIDTH + COLUMN_GAP : 0)) : undefined;

  const results = searching && query && channels.length ? (
    <Text style={s.resultCount}>
      {channels.length >= 300 ? 'More than 300 channels match' : `${channels.length} ${channels.length === 1 ? 'channel matches' : 'channels match'}`}
    </Text>
  ) : null;

  const loading = data.status === 'loading' && !data.channels.length;
  const failed = data.status === 'error' && !data.channels.length;

  const channelsList = loading ? (
    <View style={s.flex}>
      <Text style={[s.loadingText, { paddingHorizontal: wide ? spacing.sm : l.gutter }]}>Loading the channels of {provider?.name ?? 'your provider'}. A large list can take a minute.</Text>
      <LoadingState rows={8} style={wide ? { paddingHorizontal: spacing.sm } : undefined} />
    </View>
  ) : failed ? (
    <View style={[s.center, { paddingHorizontal: l.gutter }]} accessibilityRole="alert">
      <View style={s.stateIcon}>
        <Icon name="wifi.exclamationmark" size={scaled(iconSize.lg)} color={c.danger} />
      </View>
      <Text style={s.emptyTitle}>The channels did not load</Text>
      <Text style={s.emptyText}>{data.error}</Text>
      <View style={s.emptyActions}>
        <Button title="Try again" icon="arrow.clockwise" onPress={() => void iptv.refresh(providerId)} preferredFocus={isTV} />
        <Button title="Edit provider" variant="tonal" onPress={() => router.push(providerFormHref(group, { id: providerId }))} />
      </View>
    </View>
  ) : (
    <FlatList
      ref={list}
      data={channels}
      keyExtractor={(ch) => ch.id}
      style={[s.flex, listWidth !== undefined ? { width: listWidth } : null]}
      // TV: room for the heart's focus scale and ring at the trailing edge (the list clips).
      contentContainerStyle={{ paddingLeft: wide ? 0 : l.gutter, paddingRight: isTV ? tvFocusBleed(HEART_TV) : wide ? 0 : l.gutter, paddingBottom: bottomPad, paddingTop: spacing.xs, flexGrow: 1 }}
      getItemLayout={(_d, index) => ({ length: CHANNEL_ROW_HEIGHT, offset: CHANNEL_ROW_HEIGHT * index, index })}
      initialNumToRender={14}
      maxToRenderPerBatch={16}
      windowSize={9}
      removeClippedSubviews={!isTV}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY}
      // The search field, recent searches and the count sit in the list's header: the list must be a
      // direct child of the row (TV: its focus guide takes no size from a column around it).
      ListHeaderComponent={
        wide ? (
          <>
            {isTV && searchOpen ? searchField('column') : null}
            {recentChips}
            {results}
          </>
        ) : undefined
      }
      ListEmptyComponent={
        <View style={[s.listEmpty, searching && s.listEmptyTop]}>
          <Icon name={empty.icon} size={scaled(iconSize.lg)} color={c.text3} />
          <Text style={s.listEmptyTitle}>{empty.title}</Text>
          <Text style={s.listEmptyText}>{empty.text}</Text>
        </View>
      }
      renderItem={({ item }) => (
        <ChannelRow
          providerId={providerId}
          channel={item}
          favourite={favourites.has(item.id)}
          playing={item.id === playingId}
          now={now}
          showNext={!details}
          numbered={numbered}
          onPlay={onPlay}
          onToggleFavourite={toggle}
          onFocusRow={onFocusRow}
        />
      )}
    />
  );

  return (
    <>
      {title}
      <View style={s.page}>
        {isTV ? tvHeader : toolbar}
        {isTV ? null : providerChips}
        {!wide ? recentChips : null}
        {groupChips}
        {banner}
        {wide ? (
          <View style={[s.columns, { paddingLeft: l.gutter, paddingRight: l.gutter }]}>
            <BrowseColumn
              entries={entries}
              sections={sections}
              selected={searching ? SEARCH_ENTRY : groupKey}
              width={COLUMN_WIDTH}
              bottomPad={bottomPad}
              searchRef={searchEntry}
              onSearch={isTV ? openSearch : () => field.current?.focus()}
              onGroup={pickGroup}
              onSection={openSection}
              onProviders={openProviders}
            />
            {channelsList}
            {details && !loading && !failed ? <ChannelDetails providerId={providerId} channel={shown} now={now} favourite={!!shown && favourites.has(shown.id)} width={DETAILS_WIDTH} /> : null}
          </View>
        ) : (
          channelsList
        )}
      </View>
    </>
  );
}

const EMPTY: Channel[] = [];

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: c.bg },
  emptyPage: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md, paddingVertical: spacing.huge },
  stateIcon: {
    width: scaled(72),
    height: scaled(72),
    borderRadius: radius.pill,
    backgroundColor: c.accentSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: spacing.xs,
  },
  emptyTitle: { ...font(type.title3), color: c.text, textAlign: 'center' as const },
  emptyText: { ...font(type.body), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(sizes.readableWidth) },
  emptyActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md, justifyContent: 'center' as const, marginTop: spacing.md },
  tvHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  tvTitleBlock: { flex: 1, minWidth: 0 },
  tvTitle: { ...font(type.largeTitle), color: c.text },
  tvSubtitle: { ...font(type.subheadline), color: c.text2 },
  toolbar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  field: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    // The focus border is inside the field: 4 more points keep the text clear of it.
    height: scaled(sizes.webSearchHeight) + 4,
    backgroundColor: c.surface2,
    borderRadius: radius.md + 2,
    borderCurve: 'continuous' as const,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  fieldColumn: { flex: 0, marginBottom: spacing.sm },
  // TV: a text field shows its focus as a white border (design system §7.19).
  fieldFocusedTV: { borderColor: c.text },
  input: { ...font(type.body), ...webInput, color: c.text, flex: 1, height: '100%' as const },
  iconButton: { width: scaled(sizes.iconButton), height: scaled(sizes.iconButton), alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: radius.pill },
  chips: { flexGrow: 0 },
  chipsContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  recent: { gap: spacing.xxs, marginBottom: spacing.xs },
  recentTitle: { ...font(type.caption1), fontWeight: '600' as const, letterSpacing: 0.5, color: c.text3, marginLeft: spacing.xs },
  resultCount: { ...font(type.footnote), color: c.text3, marginLeft: spacing.sm, marginBottom: spacing.xs },
  banner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surface2, marginBottom: spacing.sm },
  bannerText: { ...font(type.footnote), color: c.text2, flex: 1 },
  loadingText: { ...font(type.footnote), color: c.text2, marginBottom: spacing.sm },
  listEmpty: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.sm, padding: spacing.xxl },
  // A search: the message stays above the TV keyboard.
  listEmptyTop: { justifyContent: 'flex-start' as const, paddingTop: spacing.xl },
  listEmptyTitle: { ...font(type.headline), color: c.text, textAlign: 'center' as const },
  listEmptyText: { ...font(type.subheadline), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(360) },
  columns: { flex: 1, flexDirection: 'row' as const, gap: COLUMN_GAP, paddingBottom: isTV ? spacing.sm : 0 },
}));
