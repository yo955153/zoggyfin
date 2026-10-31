/**
 * The Live TV page: the provider's channels by group (Favourites and
 * Recently watched first), a search over channel names, now and next, and
 * favourites. Narrow windows show the groups as chips over the list; wide
 * windows and TV show them as a column at the leading edge (on TV, Left from
 * that column opens the side menu).
 */
import { router, Stack } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { Chip, chipRowTV } from '@/components/chip';
import { Icon } from '@/components/icon';
import { LoadingState } from '@/components/states';
import { Touchable } from '@/components/touchable';
import { useTvRemote } from '@/features/tv/use-tv-remote';
import {
  ALL_GROUP,
  type Channel,
  FAVOURITES_GROUP,
  iptv,
  type GroupView,
  useActiveProviderId,
  useChannelLists,
  useChannels,
  useChannelView,
  useMinute,
  usePlayChannel,
  useProviders,
} from '@/iptv';
import { useTabBottomPadding } from '@/lib/tab-bar-inset';
import { useRootScreenOptions } from '@/lib/stack-options';
import { toast } from '@/lib/toast';
import { useDebounced } from '@/lib/use-debounced';
import { features, isNativeTV, isTV } from '@/platform/tv';
import { usePlayerStore } from '@/player';
import { createStyles, type AppTheme, font, iconSize, radius, scaled, sizes, spacing, type, useLayout, useStyles, useTheme, webInput } from '@/theme';

import { CHANNEL_ROW_HEIGHT, ChannelRow } from './channel-row';
import { providerFormHref, providersHref, useLiveGroup } from './nav';

export function LiveTvScreen() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const l = useLayout();
  const root = useRootScreenOptions();
  const bottomPad = useTabBottomPadding();
  const group = useLiveGroup();
  const providers = useProviders();
  const providerId = useActiveProviderId();
  const data = useChannels(providerId);
  const lists = useChannelLists(providerId);
  // The group picked for a provider (another provider starts on its own first group).
  const [pick, setPick] = useState<{ providerId: string | null; key: string } | null>(null);
  const picked = pick && pick.providerId === providerId ? pick.key : null;
  const setPicked = (key: string) => setPick({ providerId, key });
  const [text, setText] = useState('');
  const query = useDebounced(text.trim(), 150);
  // Favourites first when there are some, else every channel.
  const groupKey = picked ?? (lists.favourites.length ? FAVOURITES_GROUP : ALL_GROUP);
  const view = useChannelView(providerId, groupKey, query);
  const now = useMinute();
  const play = usePlayChannel();
  const playingId = usePlayerStore((st) => (st.now?.live && st.now.live.source.providerId === providerId ? (st.now.live.channels[st.now.live.index]?.id ?? null) : null));
  const wide = l.tv || l.bp !== 'compact';
  const favourites = useMemo(() => new Set(lists.favourites), [lists.favourites]);

  const toggle = useCallback(
    (ch: Channel) => {
      if (!providerId) return;
      const on = iptv.toggleFavourite(providerId, ch.id);
      toast(on ? `${ch.name} is in Favourites` : `${ch.name} is no longer in Favourites`, { icon: on ? 'heart.fill' : 'heart' });
    },
    [providerId],
  );
  const onPlay = useCallback(
    (ch: Channel) => {
      if (providerId) play(providerId, view.channels, ch);
    },
    [providerId, play, view.channels],
  );

  // TV: the menu key favourites the focused row (Fire TV and most Android TV remotes have it).
  const focused = useRef<Channel | null>(null);
  const onFocusRow = useCallback((ch: Channel | null) => {
    if (ch) focused.current = ch;
  }, []);
  useTvRemote(isNativeTV, (e) => {
    if (e.eventType === 'menu' && Number(e.eventKeyAction ?? -1) !== 0 && focused.current) toggle(focused.current);
  });

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
  }, [groupKey, query, providerId]);

  const title = <Stack.Screen options={{ ...root, title: 'Live TV' }} />;

  if (!providers.length || !providerId) {
    return (
      <>
        {title}
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[s.emptyPage, { paddingHorizontal: l.gutter, paddingBottom: bottomPad }]}>
          {isTV ? <Text style={s.tvTitle}>Live TV</Text> : null}
          <View style={s.center}>
            <Icon name="tv" size={scaled(sizes.stateIcon)} color={c.text3} />
            <Text style={s.emptyTitle}>Add an IPTV provider</Text>
            <Text style={s.emptyText}>
              Watch live channels from an Xtream Codes login or an M3U playlist. Your provider gives you the details.
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
  const toolbar = (
    <View style={[s.toolbar, { paddingHorizontal: l.gutter }]}>
      {isTV ? <Text style={s.tvTitle}>Live TV</Text> : null}
      <View style={s.field}>
        <Icon name="magnifyingglass" size={scaled(iconSize.sm)} color={c.text3} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Search channels"
          placeholderTextColor={c.text3}
          selectionColor={c.accent}
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
          accessibilityLabel="Search channels"
          returnKeyType="search"
        />
        {text ? (
          <Touchable onPress={() => setText('')} hitSlop={10} radius={10} accessibilityRole="button" accessibilityLabel="Clear search">
            <Icon name="xmark.circle.fill" size={scaled(iconSize.sm)} color={c.text3} />
          </Touchable>
        ) : null}
      </View>
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
      <Touchable kind="icon" radius={radius.pill} onPress={() => router.push(providersHref(group))} accessibilityRole="button" accessibilityLabel="Providers" style={s.iconButton}>
        <Icon name="gearshape" size={scaled(iconSize.sm)} color={c.text} />
      </Touchable>
    </View>
  );

  const providerChips =
    providers.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, chipRowTV(), { paddingHorizontal: l.gutter }]}>
        {providers.map((p) => (
          <Chip key={p.id} label={p.name} icon="tv" selected={p.id === providerId} onPress={() => iptv.setActive(p.id)} />
        ))}
      </ScrollView>
    ) : null;

  const groups = view.groups.filter((g) => g.count > 0 || g.key === FAVOURITES_GROUP);
  const groupChips = !wide ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chips} contentContainerStyle={[s.chipsContent, { paddingHorizontal: l.gutter }]}>
      {groups.map((g) => (
        <Chip key={g.key} label={g.label} icon={g.key === FAVOURITES_GROUP ? 'heart.fill' : undefined} selected={!query && g.key === groupKey} onPress={() => setPicked(g.key)} />
      ))}
    </ScrollView>
  ) : null;

  const banner = data.error && data.channels.length ? (
    <View style={[s.banner, { marginHorizontal: l.gutter }]} accessibilityRole="alert">
      <Icon name="exclamationmark.triangle" size={scaled(iconSize.sm)} color={c.danger} />
      <Text style={s.bannerText} numberOfLines={3}>
        {data.error}
      </Text>
    </View>
  ) : null;

  const emptyText = query
    ? `No channel names match "${query}".`
    : groupKey === FAVOURITES_GROUP
      ? isTV
        ? 'Press Right on a channel and select the heart, or press the menu key, to add it here.'
        : 'Tap the heart on a channel, or press and hold it, to add it here.'
      : 'No channels here yet.';

  const channelsList =
    data.status === 'loading' && !data.channels.length ? (
      <View style={s.flex}>
        <Text style={[s.loadingText, { paddingHorizontal: l.gutter }]}>Loading the channel list. A large list can take a minute.</Text>
        <LoadingState rows={8} />
      </View>
    ) : data.status === 'error' && !data.channels.length ? (
      <View style={[s.center, { paddingHorizontal: l.gutter }]} accessibilityRole="alert">
        <Icon name="wifi.exclamationmark" size={scaled(sizes.stateIcon)} color={c.text3} />
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
        data={view.channels}
        keyExtractor={(ch) => ch.id}
        style={s.flex}
        contentContainerStyle={{ paddingHorizontal: wide ? spacing.sm : l.gutter, paddingBottom: bottomPad, paddingTop: spacing.xs }}
        getItemLayout={(_d, index) => ({ length: CHANNEL_ROW_HEIGHT, offset: CHANNEL_ROW_HEIGHT * index, index })}
        initialNumToRender={14}
        maxToRenderPerBatch={16}
        windowSize={9}
        removeClippedSubviews={!isTV}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onViewableItemsChanged={onViewable}
        viewabilityConfig={VIEWABILITY}
        ListEmptyComponent={<Text style={s.listEmpty}>{emptyText}</Text>}
        renderItem={({ item }) => (
          <ChannelRow
            providerId={providerId}
            channel={item}
            favourite={favourites.has(item.id)}
            playing={item.id === playingId}
            now={now}
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
        {toolbar}
        {providerChips}
        {groupChips}
        {banner}
        {wide ? (
          <View style={[s.columns, { paddingLeft: l.gutter }]}>
            <GroupColumn groups={groups} selected={query ? null : groupKey} onSelect={(k) => {
              setText('');
              setPicked(k);
            }} bottomPad={bottomPad} />
            {channelsList}
          </View>
        ) : (
          channelsList
        )}
      </View>
    </>
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 30, minimumViewTime: 250 };

/** The groups as a column (wide windows and TV). On TV the selected group takes the first focus. */
function GroupColumn({ groups, selected, onSelect, bottomPad }: { groups: GroupView[]; selected: string | null; onSelect: (key: string) => void; bottomPad: number }) {
  const s = useStyles(makeStyles);
  return (
    <FlatList
      data={groups}
      keyExtractor={(g) => g.key}
      style={s.groupColumn}
      contentContainerStyle={{ paddingBottom: bottomPad, paddingTop: spacing.xs }}
      showsVerticalScrollIndicator={false}
      renderItem={({ item, index }) => {
        const on = item.key === selected;
        return (
          <Touchable
            kind="row"
            onPress={() => onSelect(item.key)}
            // TV: focus comes into the page on the selected group (or the first one during a search).
            hasTVPreferredFocus={isTV && (on || (selected === null && index === 0))}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${item.label}, ${item.count} ${item.count === 1 ? 'channel' : 'channels'}`}
            style={({ pressed, hovered, focused }) => [s.groupRow, on && s.groupSelected, (pressed || hovered) && s.groupPressed, focused && isTV && s.groupFocused]}>
            {({ focused }) => (
              <>
                <Text style={[s.groupLabel, on && s.groupLabelOn, focused && isTV && s.groupLabelFocused]} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={[s.groupCount, focused && isTV && s.groupLabelFocused]}>{item.count}</Text>
              </>
            )}
          </Touchable>
        );
      }}
    />
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  flex: { flex: 1 },
  page: { flex: 1, backgroundColor: c.bg },
  emptyPage: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing.md, paddingVertical: spacing.huge },
  emptyTitle: { ...font(type.title3), color: c.text, textAlign: 'center' as const },
  emptyText: { ...font(type.body), color: c.text2, textAlign: 'center' as const, maxWidth: scaled(sizes.readableWidth) },
  emptyActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.md, justifyContent: 'center' as const, marginTop: spacing.md },
  tvTitle: { ...font(type.largeTitle), color: c.text, marginRight: spacing.lg },
  toolbar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, paddingTop: isTV ? spacing.xxl : spacing.sm, paddingBottom: spacing.sm },
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
  iconButton: { width: scaled(sizes.iconButton), height: scaled(sizes.iconButton), alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: radius.pill },
  chips: { flexGrow: 0 },
  chipsContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  banner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: c.surface2, marginBottom: spacing.sm },
  bannerText: { ...font(type.footnote), color: c.text2, flex: 1 },
  loadingText: { ...font(type.footnote), color: c.text2, marginBottom: spacing.sm },
  listEmpty: { ...font(type.body), color: c.text2, textAlign: 'center' as const, padding: spacing.xxl },
  columns: { flex: 1, flexDirection: 'row' as const },
  groupColumn: { width: scaled(220), flexGrow: 0 },
  groupRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.sm,
    minHeight: scaled(sizes.rowMin),
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.xxs,
    borderCurve: 'continuous' as const,
  },
  groupSelected: { backgroundColor: c.accentSoft },
  groupPressed: { backgroundColor: c.surface2 },
  groupFocused: { backgroundColor: c.text },
  groupLabel: { ...font(type.body), color: c.text, flex: 1 },
  groupLabelOn: { fontWeight: '600' as const },
  groupLabelFocused: { color: c.bg },
  groupCount: { ...font(type.footnote), color: c.text3 },
}));
