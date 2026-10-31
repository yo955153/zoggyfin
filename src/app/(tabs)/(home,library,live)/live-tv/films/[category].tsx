import { useLocalSearchParams } from 'expo-router';

import { VodCategoryScreen } from '@/features/iptv/vod/vod-category-screen';

export default function FilmCategoryRoute() {
  const { category, p, name } = useLocalSearchParams<{ category: string; p?: string; name?: string }>();
  return <VodCategoryScreen kind="film" categoryId={category} providerId={p || undefined} name={name} />;
}
