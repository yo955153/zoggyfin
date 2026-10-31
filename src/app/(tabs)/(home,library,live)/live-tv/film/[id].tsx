import { useLocalSearchParams } from 'expo-router';

import { FilmDetailScreen } from '@/features/iptv/vod/film-detail-screen';

export default function FilmRoute() {
  const { id, p } = useLocalSearchParams<{ id: string; p?: string }>();
  return <FilmDetailScreen id={id} providerId={p || undefined} />;
}
