import { Stack, useLocalSearchParams } from 'expo-router';

import { useGenreItems } from '@/api/queries';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';

export default function GenreScreen() {
  const { id, name, libraryId } = useLocalSearchParams<{ id: string; name?: string; libraryId?: string }>();
  const q = useGenreItems(libraryId, id);
  return (
    <>
      <Stack.Screen options={{ title: name || 'Genre', headerLargeTitle: true }} />
      {q.isPending ? (
        <LoadingState />
      ) : q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={q.refetch} />
      ) : (
        <ItemGrid
          items={q.data ?? []}
          shape="square"
          refreshing={q.isRefetching}
          onRefresh={q.refetch}
          ListEmptyComponent={<EmptyState icon="guitars" title="No albums in this genre" />}
        />
      )}
    </>
  );
}
