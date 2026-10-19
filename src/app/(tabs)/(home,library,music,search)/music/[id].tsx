import { Stack, useLocalSearchParams } from 'expo-router';

import { MusicBrowser } from '@/features/music/music-browser';

/** A music library opened from the Library tab. */
export default function MusicLibraryScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: name || 'Music' }} />
      <MusicBrowser libraryId={id} />
    </>
  );
}
