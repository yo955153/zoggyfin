import { Stack, useLocalSearchParams } from 'expo-router';

import { useGenreItems } from '@/api/queries';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/states';

export default function GenreScreen() {
  const { id, name, libraryId } = useLocalSearchParams<{ id: string; name?: string; libraryId?: string }>();
  const q = useGenreItems(libraryId, id);
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
          ListEmptyComponent={<EmptyState icon="music.note" title="No albums in this genre" />}
        />
      )}
    </>
  );
}
