import { Stack } from 'expo-router';

import { useViews } from '@/api/queries';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { isSupportedView } from '@/features/library/library-kind';
import { rootScreenOptions } from '@/lib/stack-options';

export default function LibraryScreen() {
  const views = useViews();
  const items = (views.data ?? []).filter(isSupportedView);
  return (
    <>
      <Stack.Screen options={{ ...rootScreenOptions, title: 'Library' }} />
      {views.isPending ? (
        <LoadingState />
      ) : views.error && !views.data ? (
        <ErrorState error={views.error} onRetry={views.refetch} />
      ) : (
        <ItemGrid
          items={items}
          shape="landscape"
          refreshing={views.isRefetching}
          onRefresh={views.refetch}
          ListEmptyComponent={<EmptyState icon="square.grid.2x2" title="No libraries" message="This account has no libraries yet." />}
        />
      )}
    </>
  );
}
