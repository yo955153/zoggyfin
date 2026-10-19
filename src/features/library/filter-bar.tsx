import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { useFilters } from '@/api/queries';
import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { colors, GUTTER, iconSize, radius, spacing, type } from '@/theme';

import { hasActiveFilters, SORT_OPTIONS, toggle, useFiltersFor, useLibraryFilters } from './filter-store';

type SheetName = 'sort' | 'played' | 'genre' | 'year' | null;

/** Sort and filter chips for a library grid. */
export function FilterBar({ libraryId, itemTypes }: { libraryId: string; itemTypes: readonly string[] }) {
  const f = useFiltersFor(libraryId);
  const update = useLibraryFilters((s) => s.update);
  const reset = useLibraryFilters((s) => s.reset);
  const [sheet, setSheet] = useState<SheetName>(null);
  const filters = useFilters(libraryId, itemTypes);

  const sortLabel = SORT_OPTIONS.find((o) => o.value === f.sortBy)?.label ?? 'Name';
  const playedLabel = f.played === 'played' ? 'Watched' : f.played === 'unplayed' ? 'Unwatched' : 'All';

  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bar} style={styles.scroll}>
        <Chip label={sortLabel} icon="arrow.up.arrow.down" onPress={() => setSheet('sort')} />
        <Chip
          label={f.sortOrder === 'Ascending' ? 'Ascending' : 'Descending'}
          onPress={() => update(libraryId, { sortOrder: f.sortOrder === 'Ascending' ? 'Descending' : 'Ascending' })}
        />
        <Chip label={playedLabel} active={f.played !== 'all'} onPress={() => setSheet('played')} />
        <Chip label="Favorites" icon={f.favorites ? 'heart.fill' : 'heart'} active={f.favorites} onPress={() => update(libraryId, { favorites: !f.favorites })} />
        <Chip label={f.genres.length ? `Genres (${f.genres.length})` : 'Genre'} active={f.genres.length > 0} onPress={() => setSheet('genre')} />
        <Chip label={f.years.length ? `Years (${f.years.length})` : 'Year'} active={f.years.length > 0} onPress={() => setSheet('year')} />
        {hasActiveFilters(f) ? <Chip label="Clear" icon="xmark" onPress={() => reset(libraryId)} /> : null}
      </ScrollView>

      <OptionSheet
        visible={sheet === 'sort'}
        title="Sort by"
        options={SORT_OPTIONS}
        selected={[f.sortBy]}
        onSelect={(v) => update(libraryId, { sortBy: v })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'played'}
        title="Show"
        options={[
          { value: 'all' as const, label: 'All' },
          { value: 'unplayed' as const, label: 'Unwatched' },
          { value: 'played' as const, label: 'Watched' },
        ]}
        selected={[f.played]}
        onSelect={(v) => update(libraryId, { played: v })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'genre'}
        title="Genres"
        multiple
        options={(filters.data?.Genres ?? []).map((g) => ({ value: g, label: g }))}
        selected={f.genres}
        onSelect={(v) => update(libraryId, { genres: toggle(f.genres, v) })}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === 'year'}
        title="Years"
        multiple
        options={[...(filters.data?.Years ?? [])].sort((a, b) => b - a).map((y) => ({ value: y, label: String(y) }))}
        selected={f.years}
        onSelect={(v) => update(libraryId, { years: toggle(f.years, v) })}
        onClose={() => setSheet(null)}
      />
    </>
  );
}

function Chip({ label, icon, active, onPress }: { label: string; icon?: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.chip,
        active && styles.chipActive,
        (pressed || hovered) && { opacity: 0.8 },
      ]}>
      {icon ? <Icon name={icon} size={iconSize.sm} color={active ? colors.accentText : colors.text} /> : null}
      <Text style={[styles.chipText, active && { color: colors.accentText }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { marginHorizontal: -GUTTER, marginBottom: spacing.md },
  bar: { paddingHorizontal: GUTTER, gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs2,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.row,
    paddingVertical: spacing.xs2 + 1,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { ...type.chip, color: colors.text },
});
