import { useLocalSearchParams } from 'expo-router';

import { VodHomeScreen } from '@/features/iptv/vod/vod-home-screen';

export default function FilmsRoute() {
  const { p } = useLocalSearchParams<{ p?: string }>();
  return <VodHomeScreen kind="film" providerId={p || undefined} />;
}
