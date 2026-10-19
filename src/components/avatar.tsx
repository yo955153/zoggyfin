import { Image } from 'expo-image';
import { PixelRatio, Text, View } from 'react-native';

import type { Session } from '@/auth/session-store';
import { initials } from '@/images/generated-art';
import { buildUserImageUrl, imageSource } from '@/images/image-url';
import { createStyles, type AppTheme, fallbackArt, font, mediaColors, type, useStyles } from '@/theme';

/** What the avatar needs: a session, or a saved user of a server (no token: user pictures are public). */
export type AvatarUser = Pick<Session, 'serverId' | 'serverUrl' | 'userId' | 'userName' | 'userImageTag'> & { token: string | null };

/** The user's picture, or initials on the generated-art colour of the user name. */
export function Avatar({ session, size }: { session: AvatarUser; size: number }) {
  const s = useStyles(makeStyles);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (session.userImageTag) {
    const server = { baseUrl: session.serverUrl, token: session.token, serverId: session.serverId };
    const uri = buildUserImageUrl(
      server,
      session.userId,
      session.userImageTag,
      size * PixelRatio.get(),
    );
    return <Image source={imageSource(uri, server)} style={[box, s.bg]} contentFit="cover" recyclingKey={`${session.serverId}.${session.userId}`} accessibilityIgnoresInvertColors />;
  }
  const art = fallbackArt(session.userName, session.userId);
  return (
    <View style={[box, s.center, { backgroundColor: art.from }]}>
      <Text style={[s.initial, { fontSize: size * 0.42, lineHeight: size * 0.5 }]}>{initials(session.userName).slice(0, 1)}</Text>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  bg: { backgroundColor: c.surface2 },
  center: { alignItems: 'center' as const, justifyContent: 'center' as const },
  initial: { ...font(type.headline), color: mediaColors.white },
}));
