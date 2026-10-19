import { router, Stack } from 'expo-router';
import { Platform, ScrollView } from 'react-native';

import { EmptyState } from '@/components/states';
import { useDownloads } from '@/downloads';
import { useRootScreenOptions } from '@/lib/stack-options';
import { createStyles, type AppTheme, useStyles, useTheme } from '@/theme';

export default function DownloadsScreen() {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const root = useRootScreenOptions();
  const downloads = useDownloads();
  const empty = downloads.inProgress.length === 0 && downloads.downloaded.length === 0;
  return (
    <>
      <Stack.Screen
        options={{
          ...root,
          title: 'Downloads',
          headerStyle: { backgroundColor: c.bgGrouped },
          headerLargeStyle: { backgroundColor: c.bgGrouped },
          contentStyle: { backgroundColor: c.bgGrouped },
        }}
      />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={s.page} contentContainerStyle={s.content}>
        {empty ? (
          Platform.OS === 'web' ? (
            <EmptyState
              icon="arrow.down.circle"
              title="Downloads are not on the web"
              message="Use the iPhone or iPad app to keep movies, episodes and albums on the device."
            />
          ) : (
            <EmptyState
              icon="arrow.down.circle"
              title="No downloads yet"
              message="Tap the download button on any movie, episode or album."
              action={{ title: 'Browse library', onPress: () => router.navigate('/(tabs)/(library)/libraries') }}
            />
          )
        ) : null}
      </ScrollView>
    </>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { backgroundColor: c.bgGrouped },
  content: { flexGrow: 1 },
}));
