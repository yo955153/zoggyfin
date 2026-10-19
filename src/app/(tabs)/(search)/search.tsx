import { Stack } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SearchBarCommands } from 'react-native-screens';

import { useSearch } from '@/api/queries';
import { Icon } from '@/components/icon';
import { ItemRow, RowHeader } from '@/components/item-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { shapeFor } from '@/components/tile';
import { groupSearchResults, pushRecentSearch } from '@/features/search/group-results';
import { useDebounced } from '@/lib/use-debounced';
import { readJson, writeJson } from '@/storage/json';
import { colors, GUTTER, iconSize, motion, radius, size, spacing, type } from '@/theme';

const RECENT_KEY = 'search.recent';

export default function SearchScreen() {
  const [text, setText] = useState('');
  const term = useDebounced(text.trim(), motion.searchDebounce);
  const q = useSearch(term);
  const sections = useMemo(() => groupSearchResults(q.data ?? []), [q.data]);
  const [recentVersion, setRecentVersion] = useState(0);
  const searchRef = useRef<SearchBarCommands>(null);

  // Remember a search once it returns results.
  const hasResults = !!q.data?.length;
  useEffect(() => {
    if (term.length >= 2 && hasResults) {
      writeJson(RECENT_KEY, pushRecentSearch(readJson<string[]>(RECENT_KEY, []), term));
    }
  }, [term, hasResults]);

  const active = term.length >= 2;
  // Read when the recent list is on screen; it changes only between searches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recent = useMemo(() => readJson<string[]>(RECENT_KEY, []), [active, recentVersion]);

  const applyRecent = (s: string) => {
    setText(s);
    searchRef.current?.setText(s);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Search',
          headerLargeTitle: true,
          headerSearchBarOptions:
            Platform.OS === 'web'
              ? undefined
              : {
                  ref: searchRef,
                  placeholder: 'Movies, shows, music, people',
                  autoCapitalize: 'none',
                  hideWhenScrolling: false,
                  onChangeText: (e) => setText(e.nativeEvent.text),
                  onCancelButtonPress: () => setText(''),
                },
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}>
        {Platform.OS === 'web' ? (
          <View style={styles.webSearch}>
            <Icon name="magnifyingglass" size={iconSize.md} color={colors.textSecondary} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Movies, shows, music, people"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoFocus
              style={styles.webInput}
              accessibilityLabel="Search"
            />
          </View>
        ) : null}

        {!active ? (
          recent.length ? (
            <View style={styles.recent}>
              <RowHeader title="Recent Searches" />
              {recent.map((r) => (
                <Pressable key={r} onPress={() => applyRecent(r)} style={styles.recentRow} accessibilityRole="button">
                  <Icon name="clock.arrow.circlepath" size={iconSize.md} color={colors.textSecondary} />
                  <Text style={styles.recentText}>{r}</Text>
                </Pressable>
              ))}
              <Pressable
                onPress={() => {
                  writeJson(RECENT_KEY, []);
                  setRecentVersion((v) => v + 1);
                }}
                style={styles.clear}
                accessibilityRole="button">
                <Text style={styles.clearText}>Clear Recent Searches</Text>
              </Pressable>
            </View>
          ) : (
            <EmptyState icon="magnifyingglass" title="Search your server" message="Find movies, shows, episodes, albums, songs, artists and people." />
          )
        ) : q.isPending ? (
          <LoadingState />
        ) : q.error && !q.data ? (
          <ErrorState error={q.error} onRetry={q.refetch} />
        ) : sections.length === 0 ? (
          <EmptyState icon="magnifyingglass" title={`No results for "${term}"`} message="Check the spelling or try fewer words." />
        ) : (
          <View style={q.isFetching ? styles.stale : undefined}>
            {sections.map((s) => (
              <ItemRow key={s.key} title={s.title} items={s.items} shape={s.items[0] ? shapeFor(s.items[0]) : 'poster'} />
            ))}
          </View>
        )}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: spacing.xxl * 2 },
  stale: { opacity: 0.6 },
  recent: { marginTop: spacing.lg },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: GUTTER, paddingVertical: spacing.md },
  recentText: { ...type.body, color: colors.text },
  clear: { paddingHorizontal: GUTTER, paddingVertical: spacing.md },
  clearText: { ...type.callout, color: colors.accent },
  webSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: GUTTER,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  webInput: { ...type.body, color: colors.text, flex: 1, minHeight: size.webFieldHeight },
});
