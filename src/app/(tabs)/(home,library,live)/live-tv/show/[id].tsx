import { useLocalSearchParams } from 'expo-router';

import { SeriesDetailScreen } from '@/features/iptv/vod/series-detail-screen';

export default function ShowRoute() {
  const { id, p } = useLocalSearchParams<{ id: string; p?: string }>();
  return <SeriesDetailScreen id={id} providerId={p || undefined} />;
}
