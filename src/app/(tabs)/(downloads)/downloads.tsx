import { Stack } from 'expo-router';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { EmptyState } from '@/components/states';
import { useDownloads } from '@/downloads';
import { rootScreenOptions } from '@/lib/stack-options';

export default function DownloadsScreen() {
  const downloads = useDownloads();
  const empty = downloads.inProgress.length === 0 && downloads.downloaded.length === 0;
  return (
    <>
      <Stack.Screen options={{ ...rootScreenOptions, title: 'Downloads' }} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
        {empty ? (
          <EmptyState
            icon="arrow.down.circle"
            title={Platform.OS === 'web' ? 'Downloads are not available on the web' : 'No downloads yet'}
            message={
              Platform.OS === 'web'
                ? 'Use the iPhone or iPad app to keep movies and music on the device.'
                : 'Downloaded movies, episodes and albums will show here, with what is still in progress.'
            }
          />
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({ content: { flexGrow: 1 } });
