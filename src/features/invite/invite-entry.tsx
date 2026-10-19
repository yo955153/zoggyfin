/**
 * "Paste invite" and "I have an invite link" on the first screen. For a
 * person who installed the app from an invite: the invite page copied the
 * link, so one tap on Paste invite opens "Join <Server>?". The clipboard is
 * read only after this tap.
 */
import { type Href, router } from 'expo-router';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { canReadClipboard, readClipboard } from '@/invite/clipboard';
import { setIncomingInvite } from '@/invite/incoming';
import { payloadFromText } from '@/invite/payload';
import { createStyles, type AppTheme, font, spacing, type, useStyles } from '@/theme';

export function InviteEntry() {
  const s = useStyles(makeStyles);
  // With no invite on the clipboard, the invite screen asks for the link.
  const paste = async () => {
    const payload = payloadFromText((await readClipboard()) ?? '');
    if (payload) setIncomingInvite(payload);
    router.push('/accept-invite' as Href);
  };

  return (
    <View style={s.wrap}>
      <Text style={s.or}>Got an invite?</Text>
      {canReadClipboard ? <Button title="Paste invite" variant="tonal" onPress={() => void paste()} /> : null}
      <Button title="I have an invite link" variant="text" onPress={() => router.push('/accept-invite' as Href)} />
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  wrap: { gap: spacing.sm, marginTop: spacing.lg },
  or: { ...font(type.footnote), color: c.text2, textAlign: 'center' as const },
}));
