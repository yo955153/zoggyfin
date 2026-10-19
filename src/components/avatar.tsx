import { Image } from 'expo-image';
import { PixelRatio, StyleSheet, Text, View } from 'react-native';

import type { Session } from '@/auth/session-store';
import { generatedArt } from '@/images/generated-art';
import { buildUserImageUrl } from '@/images/image-url';
import { colors, type } from '@/theme';

export function Avatar({ session, size }: { session: Session; size: number }) {
  const art = generatedArt(session.userName, 'Person');
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (session.userImageTag) {
    const uri = buildUserImageUrl(
      { baseUrl: session.serverUrl, token: session.token },
      session.userId,
      session.userImageTag,
      size * PixelRatio.get(),
    );
    return <Image source={{ uri }} style={[box, styles.bg]} contentFit="cover" recyclingKey={uri} />;
  }
  return (
    <View style={[box, styles.center, { backgroundColor: art.colors[0] }]}>
      <Text style={[styles.initial, { fontSize: size * 0.45 }]}>{session.userName.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { backgroundColor: colors.surface },
  center: { alignItems: 'center', justifyContent: 'center' },
  initial: { ...type.initial, color: colors.onImage },
});
