/**
 * "Send link to…": a link goes to an extension that takes it (for example
 * "Download"). It opens from Settings, from a `zoggyfin://share?url=` link
 * (iOS Shortcuts, other apps), from an Android share, or with
 * `/share?url=` on web and in the Mac app.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { EmptyState } from '@/components/states';
import { TextField } from '@/components/text-field';
import { runShareTarget, shareTargetsFor } from '@/extensions/runtime';
import { useExtensions } from '@/extensions/store';
import { ModalHeader } from '@/extensions/ui/modal-header';
import { Group, makeSettingsStyles, SettingsRow } from '@/features/settings/rows';
import { createStyles, type AppTheme, font, spacing, type, useStyles } from '@/theme';

export default function ShareScreen() {
  const params = useLocalSearchParams<{ url?: string; text?: string }>();
  const st = useStyles(makeSettingsStyles);
  const s = useStyles(makeStyles);
  const [text, setText] = useState(String(params.url ?? params.text ?? ''));
  const [running, setRunning] = useState<string | null>(null);
  const hasTargets = useExtensions((x) => x.list.some((e) => e.enabled && (e.manifest.contributes.shareTargets?.length ?? 0) > 0));
  const { link, targets } = shareTargetsFor(text);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)/(home)'));

  return (
    <View style={s.page}>
      <ModalHeader title="Send link" onClose={close} modal={false} />
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <View style={st.inner}>
          {!hasTargets ? (
            <EmptyState icon="square.grid.2x2" title="No extension takes links" message="Add an extension that takes links in Settings, Extensions." />
          ) : (
            <>
              <TextField label="Link" value={text} onChangeText={setText} placeholder="https://" autoCapitalize="none" autoCorrect={false} keyboardType="url" autoFocus={!text} />
              {text && !link ? <Text style={s.note}>This is not a link. A link starts with http:// or https://.</Text> : null}
              {link && !targets.length ? <Text style={s.note}>No extension takes links from this site.</Text> : null}
              {targets.length ? (
                <Group title="Send to">
                  {targets.map(({ ext, target }, i) => {
                    const key = `${ext.manifest.id}.${target.id}`;
                    return (
                      <SettingsRow
                        key={key}
                        icon="square.grid.2x2"
                        label={target.title}
                        value={running === key ? 'Sending' : ext.manifest.name}
                        last={i === targets.length - 1}
                        onPress={async () => {
                          if (!link || running) return;
                          setRunning(key);
                          try {
                            await runShareTarget(ext, target, link);
                          } finally {
                            setRunning(null);
                          }
                        }}
                      />
                    );
                  })}
                </Group>
              ) : null}
              {link ? <Button title="Done" variant="tonal" onPress={close} /> : null}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  page: { flex: 1, backgroundColor: c.bgGrouped },
  note: { ...font(type.footnote), color: c.text2, marginHorizontal: spacing.lg },
}));
