/**
 * A channel logo: the provider's image on a `surface2` plate (logos are
 * often transparent PNGs), or the first letters of the name when there is
 * no logo or it does not load.
 */
import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { createStyles, type AppTheme, font, radius, type, useStyles } from '@/theme';

/** The first letters of a channel name, for a logo that is missing. */
export function initials(name: string): string {
  const words = name.replace(/[!-\/:-@[-`{-~]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '#';
  return (words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[1][0]}`).toUpperCase();
}

export function ChannelLogo({ uri, name, size }: { uri: string | null | undefined; name: string; size: number }) {
  const s = useStyles(makeStyles);
  const [failed, setFailed] = useState<string | null>(null);
  const show = !!uri && /^https?:\/\//i.test(uri) && failed !== uri;
  return (
    <View style={[s.plate, { width: size * 1.4, height: size }]} accessible={false}>
      {show ? (
        <Image
          source={{ uri }}
          style={{ width: size * 1.3, height: size * 0.9 }}
          contentFit="contain"
          recyclingKey={uri}
          cachePolicy="disk"
          transition={120}
          onError={() => setFailed(uri)}
        />
      ) : (
        <Text style={[s.letters, { fontSize: Math.round(size * 0.34) }]} numberOfLines={1}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  plate: {
    borderRadius: radius.sm,
    backgroundColor: c.surface2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
    borderCurve: 'continuous' as const,
  },
  letters: { ...font(type.headline), color: c.text2 },
}));
