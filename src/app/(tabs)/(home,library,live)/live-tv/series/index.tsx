import { useLocalSearchParams } from 'expo-router';

import { VodHomeScreen } from '@/features/iptv/vod/vod-home-screen';

export default function SeriesRoute() {
  const { p } = useLocalSearchParams<{ p?: string }>();
  return <VodHomeScreen kind="series" providerId={p || undefined} />;
}
