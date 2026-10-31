import { useLocalSearchParams } from 'expo-router';

import { ProviderForm } from '@/features/iptv/provider-form';

export default function ProviderRoute() {
  const { id, kind } = useLocalSearchParams<{ id?: string; kind?: string }>();
  return <ProviderForm id={id || undefined} kind={kind === 'm3u' ? 'm3u' : kind === 'xtream' ? 'xtream' : undefined} />;
}
