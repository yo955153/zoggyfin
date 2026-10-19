import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';

import { useFilters } from '@/api/queries';
import { Chip } from '@/components/chip';
import { OptionSheet } from '@/components/option-sheet';
import { spacing, useLayout } from '@/theme';

import { hasActiveFilters, SORT_OPTIONS, toggle, useFiltersFor, useLibraryFilters } from './filter-store';

type SheetName = 'sort' | 'played' | 'genre' | 'year' | null;

/** Sort and filter chips for a library grid. */
export function FilterBar({ libraryId, itemTypes }: { libraryId: string; itemTypes: readonly string[] }) {
  const f = useFiltersFor(libraryId);
  const update = useLibraryFilters((s) => s.update);
  const reset = useLibraryFilters((s) => s.reset);
  const [sheet, setSheet] = useState<SheetName>(null);
  const l = useLayout();
  const filters = useFilters(libraryId, itemTypes);

  const sortLabel = SORT_OPTIONS.find((o) => o.value === f.sortBy)?.label ?? 'Name';
  const playedLabel = f.played === 'played' ? 'Played' : f.played === 'unplayed' ? 'Unplayed' : 'All';

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.bar, { paddingHorizontal: l.gutter }]}
        style={[styles.scroll, { marginHorizontal: -l.gutter }]}>
        <Chip
          label={sortLabel}
          icon="arrow.up.arrow.down"
          onPress={() => setSheet('sort')}
          accessibilityLabel={`Sort by ${sortLabel}, ${f.sortOrder === 'Ascending' ? 'ascending' : 'descending'}`}
        />
        <Chip
          label={f.sortOrder === 'Ascending' ? 'Ascending' : 'Descending'}
          onPress={() => update(libraryId, { sortOrder: f.sortOrder === 'Ascending' ? 'Descending' : 'Ascending' })}
        />
        <Chip label={playedLabel} selected={f.played !== 'all'} onPress={() => setSheet('played')} />
        <Chip label="Favourites" selected={f.favorites} onPress={() => update(libraryId, { favorites: !f.favorites })} />
        <Chip label={f.genres.length ? `Genres · ${f.genres.length}` : 'Genre'} selected={f.genres.length > 0} onPress={() => setSheet('genre')} />
        <Chip label={f.years.length ? `Years · ${f.years.length}` : 'Year'} selected={f.years.length > 0} onPress={() => setSheet('year')} />
        {hasActiveFilters(f) ? <Chip label="Clear" icon="xmark" onPress={() => reset(libraryId)} accessibilityLabel="Clear filters" /> : null}
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
          { value: 'unplayed' as const, label: 'Unplayed' },
          { value: 'played' as const, label: 'Played' },
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

const styles = StyleSheet.create({
  scroll: { marginBottom: spacing.md, flexGrow: 0 },
  bar: { gap: spacing.sm, paddingVertical: spacing.xs },
});
