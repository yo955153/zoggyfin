import { Stack } from 'expo-router';

import { useViews } from '@/api/queries';
import { ItemGrid } from '@/components/item-grid';
import { EmptyState, ErrorState, GridSkeleton } from '@/components/states';
import { isSupportedView } from '@/features/library/library-kind';
import { useRootScreenOptions } from '@/lib/stack-options';

export default function LibraryScreen() {
  const root = useRootScreenOptions();
  const views = useViews();
  const items = (views.data ?? []).filter(isSupportedView);
  return (
    <>
      <Stack.Screen options={{ ...root, title: 'Library' }} />
      {views.isPending ? (
        <GridSkeleton shape="thumb" />
      ) : views.error && !views.data ? (
        <ErrorState error={views.error} onRetry={views.refetch} />
      ) : (
        <ItemGrid
          items={items}
          shape="thumb"
          onRefresh={views.refetch}
          ListEmptyComponent={<EmptyState icon="square.stack" title="No libraries" message="This account has no libraries yet." />}
        />
      )}
    </>
  );
}
