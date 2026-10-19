import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useGenreItems } from '@/api/queries';
import type { BaseItemDto } from '@/api/types';
import { Button } from '@/components/button';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/states';
import { usePlayer } from '@/player';
import { spacing, useLayout } from '@/theme';

/** A music genre: Play, Shuffle and Instant mix, then its albums. */
export default function GenreScreen() {
  const { id, name, libraryId } = useLocalSearchParams<{ id: string; name?: string; libraryId?: string }>();
  const q = useGenreItems(libraryId, id);
  const player = usePlayer();
  const l = useLayout();
  const genre: BaseItemDto = { Id: id, Name: name, Type: 'MusicGenre' };
  const header = (
    <View style={[styles.actions, l.fontScale >= 1.5 && styles.stack]}>
      <Button title="Play" icon="play.fill" variant="tonalAccent" onPress={() => player.play({ item: genre })} containerStyle={styles.flex} />
      <Button title="Shuffle" icon="shuffle" variant="tonalAccent" onPress={() => player.play({ item: genre, shuffle: true })} containerStyle={styles.flex} />
      <Button title="Mix" icon="wand.and.stars" variant="tonalAccent" onPress={() => player.instantMix(genre)} containerStyle={styles.flex} accessibilityLabel="Instant mix" />
    </View>
  );
  return (
    <>
      <Stack.Screen options={{ title: name || 'Genre', headerLargeTitleEnabled: true }} />
      {q.isPending ? (
        <GridSkeleton shape="square" />
      ) : q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <ItemGrid
          items={q.data ?? []}
          shape="square"
          onRefresh={q.refetch}
          ListHeaderComponent={q.data?.length ? header : null}
          ListEmptyComponent={<EmptyState icon="music.note" title="No albums in this genre" />}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  stack: { flexDirection: 'column' },
});
