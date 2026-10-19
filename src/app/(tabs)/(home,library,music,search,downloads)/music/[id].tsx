import { Stack, useLocalSearchParams } from 'expo-router';

import { MusicBrowser } from '@/features/music/music-browser';

/** A music or audiobook library opened from the Library tab. */
export default function MusicLibraryScreen() {
  const { id, name, kind } = useLocalSearchParams<{ id: string; name?: string; kind?: string }>();
  return (
    <>
      <Stack.Screen options={{ title: name || 'Music' }} />
      <MusicBrowser libraryId={id} kind={kind === 'books' ? 'books' : 'music'} />
    </>
  );
}
