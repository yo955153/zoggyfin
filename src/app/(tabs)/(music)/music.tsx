import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useViews } from '@/api/queries';
import { Icon } from '@/components/icon';
import { OptionSheet } from '@/components/option-sheet';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { isAudioView } from '@/features/library/library-kind';
import { MusicBrowser } from '@/features/music/music-browser';
import { storage } from '@/storage/kv';
import { colors, iconSize, spacing, type } from '@/theme';

const KEY = 'music.library';

export default function MusicScreen() {
  const views = useViews();
  const audio = (views.data ?? []).filter(isAudioView);
  const [chosen, setChosen] = useState(() => storage.getString(KEY));
  const [picker, setPicker] = useState(false);
  const library = audio.find((v) => v.Id === chosen) ?? audio[0];

  return (
    <>
      <Stack.Screen
        options={{
          title: audio.length > 1 ? (library?.Name ?? 'Music') : 'Music',
          headerRight:
            audio.length > 1
              ? () => (
                  <Pressable onPress={() => setPicker(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Choose library" style={styles.pick}>
                    <Text style={styles.pickText}>Library</Text>
                    <Icon name="chevron.down" size={iconSize.sm} color={colors.text} />
                  </Pressable>
                )
              : undefined,
        }}
      />
      {views.isPending ? (
        <LoadingState />
      ) : views.error && !views.data ? (
        <ErrorState error={views.error} onRetry={views.refetch} />
      ) : library?.Id ? (
        <MusicBrowser key={library.Id} libraryId={library.Id} />
      ) : (
        <EmptyState icon="music.note" title="No music library" message="Add a music library on the server to see it here." />
      )}
      <OptionSheet
        visible={picker}
        title="Music library"
        options={audio.map((v) => ({ value: v.Id ?? '', label: v.Name ?? 'Music' }))}
        selected={[library?.Id ?? '']}
        onSelect={(id) => {
          storage.set(KEY, id);
          setChosen(id);
        }}
        onClose={() => setPicker(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  pick: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs2 },
  pickText: { ...type.bodyStrong, color: colors.text },
});
