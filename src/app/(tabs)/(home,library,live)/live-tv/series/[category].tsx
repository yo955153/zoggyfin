import { useLocalSearchParams } from 'expo-router';

import { VodCategoryScreen } from '@/features/iptv/vod/vod-category-screen';

export default function SeriesCategoryRoute() {
  const { category, p, name } = useLocalSearchParams<{ category: string; p?: string; name?: string }>();
  return <VodCategoryScreen kind="series" categoryId={category} providerId={p || undefined} name={name} />;
}
