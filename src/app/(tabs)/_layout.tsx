import { NativeTabs } from 'expo-router/native-tabs';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useDownloadsStore } from '@/downloads/store';
import { GlobalPlayerKeys } from '@/features/player/global-keys';
import { MiniPlayer, useMiniPlayerVisible } from '@/features/player/mini-player';
import { features } from '@/platform/tv';
import { fontFamily, spacing, useLayout, useTheme } from '@/theme';

/** iOS 26 has the tab bar bottom accessory slot; elsewhere the mini player floats. */
const HAS_ACCESSORY = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

/** The accessory renders twice (regular and inline); each copy picks its layout. */
function Accessory() {
  const placement = NativeTabs.BottomAccessory.usePlacement();
  return <MiniPlayer inline={placement === 'inline'} />;
}

/** Native tab bar height, for the floating mini player on web and older iOS. */
const TAB_BAR_HEIGHT = Platform.OS === 'web' ? 68 : 49;

function FloatingMiniPlayer() {
  const insets = useSafeAreaInsets();
  const l = useLayout();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.floating, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.sm, left: l.gutter, right: l.gutter }]}>
      <MiniPlayer floating />
    </View>
  );
}

/**
 * The five native tabs. On iPad and Mac the bar can turn into a sidebar
 * (sidebarAdaptable). Each tab has its own stack.
 */
/** The Downloads tab badge: active downloads, or "!" when one has failed. */
function useDownloadsBadge(): string | null {
  return useDownloadsStore((s) => {
    let active = 0;
    let failed = 0;
    for (const r of Object.values(s.records)) {
      if (r.state === 'downloading' || r.state === 'queued') active++;
      else if (r.state === 'failed') failed++;
    }
    return active ? String(active) : failed ? '!' : null;
  });
}

export default function TabsLayout() {
  const mini = useMiniPlayerVisible();
  const { c } = useTheme();
  const badge = useDownloadsBadge();
  const tabs = (
    <NativeTabs
      tintColor={c.accent}
      sidebarAdaptable
      minimizeBehavior="onScrollDown"
      {...(Platform.OS === 'web'
        ? {
            indicatorColor: c.accentSoft,
            labelStyle: { color: c.text2, fontWeight: '600' as const, fontSize: 13, fontFamily: fontFamily.web },
          }
        : null)}>
      {HAS_ACCESSORY && mini ? (
        <NativeTabs.BottomAccessory>
          <Accessory />
        </NativeTabs.BottomAccessory>
      ) : null}
      <NativeTabs.Trigger name="(home)" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} md="home" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(library)" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Library</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'square.stack', selected: 'square.stack.fill' }} md="stacks" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(music)" disableAutomaticContentInsets>
        <NativeTabs.Trigger.Label>Music</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="music.note" md="music_note" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(downloads)" disableAutomaticContentInsets hidden={!features.downloads}>
        <NativeTabs.Trigger.Label>Downloads</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'arrow.down.circle', selected: 'arrow.down.circle.fill' }} md="download" />
        <NativeTabs.Trigger.Badge hidden={!badge}>{badge ?? undefined}</NativeTabs.Trigger.Badge>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="(search)" disableAutomaticContentInsets role="search">
        <NativeTabs.Trigger.Label>Search</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="magnifyingglass" md="search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
  return (
    <View style={styles.flex}>
      {tabs}
      {mini && !HAS_ACCESSORY ? <FloatingMiniPlayer /> : null}
      <GlobalPlayerKeys />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  floating: { position: 'absolute' },
});
