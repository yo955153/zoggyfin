/**
 * The "Watch together" session sheet (design spec, Watch together): start
 * or join a nearby session or a SyncPlay group, answer join requests, see
 * the people in the session, who controls, and end or leave.
 */
import { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import type { BaseItemDto } from '@/api/types';
import { useSessionStore } from '@/auth/session-store';
import { Button } from '@/components/button';
import { Icon, type IconName } from '@/components/icon';
import { Sheet } from '@/components/sheet';
import { useOffline } from '@/lib/online';
import { usePlayerStore } from '@/player/store';
import { createStyles, type AppTheme, font, radius, scaled, sizes, spacing, type, useStyles, useTheme } from '@/theme';
import { canHostNearby, nearby, nearbySupported } from '@/together/nearby';
import { features } from '@/platform/tv';
import { closeTogetherSheet, openTogetherSheet, type SheetPlace, type TogetherState, useTogetherStore } from '@/together/store';
import { canSyncPlay, syncPlay, syncPlaySupported } from '@/together/syncplay';
import { groupStateLabel } from '@/together/syncplay-logic';

const VIDEO_TYPES = new Set(['Movie', 'Episode', 'Video', 'MusicVideo']);

/** The item page's "Together" action, or null where watch together does not apply. */
export function useTogetherEntry(item: BaseItemDto): (() => void) | null {
  const signedIn = useSessionStore((s) => !!s.session);
  if (!features.watchTogether || !VIDEO_TYPES.has(item.Type ?? '')) return null;
  if (!nearbySupported && !(syncPlaySupported && signedIn)) return null;
  return () => openTogetherSheet('item', item);
}

/** Mount once per screen that can open the sheet; it shows only for its own screen. */
export function TogetherSheetHost({ where }: { where: SheetPlace }) {
  const open = useTogetherStore((s) => s.sheet.open && s.sheet.where === where);
  return open ? <TogetherSheet /> : null;
}

function TogetherSheet() {
  const st = useTogetherStore();
  const playing = usePlayerStore((s) => s.now?.item ?? null);
  // The join place (sign-in screen, offline banner) only joins; hosting starts from a playing download.
  const item: BaseItemDto | null = st.sheet.where === 'join' ? null : (st.sheet.item ?? playing);
  const signedIn = useSessionStore((s) => !!s.session);
  const offline = useOffline();
  const nearbySession = st.mode === 'nearby' && st.phase.name !== 'browsing' && st.phase.name !== 'idle';
  const group = st.syncplay.group;
  const lobby = !nearbySession && !group;

  // In the lobby: look for nearby sessions and SyncPlay groups.
  useEffect(() => {
    if (!lobby) return;
    if (nearbySupported) nearby().browse();
    if (signedIn && !offline && syncPlaySupported) void syncPlay().refreshGroups();
  }, [lobby, signedIn, offline]);

  const close = () => {
    closeTogetherSheet();
    // Stop looking when nothing was joined.
    const s = useTogetherStore.getState();
    if (s.mode === 'nearby' && (s.phase.name === 'browsing' || s.phase.name === 'idle')) void nearby().stopAll();
  };

  const title = group ? group.name : nearbySession ? (st.item?.name ?? 'Watch together') : 'Watch together';
  return (
    <Sheet visible title={title} onClose={close} doneLabel="Done">
      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.xl, paddingBottom: spacing.md }}>
        {group ? <GroupView st={st} item={item} /> : nearbySession ? <NearbyView st={st} /> : <Lobby st={st} item={item} signedIn={signedIn} offline={offline} />}
      </ScrollView>
    </Sheet>
  );
}

// ---- Lobby -------------------------------------------------------------------

function Lobby({ st, item, signedIn, offline }: { st: TogetherState; item: BaseItemDto | null; signedIn: boolean; offline: boolean }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const isVideo = !!item && VIDEO_TYPES.has(item.Type ?? '');
  const hostable = canHostNearby(item);
  return (
    <>
      {nearbySupported ? (
        <Section title="Nearby" footer="Works with no internet, for example on a plane. People nearby need Zoggyfin on an iPhone, iPad or Mac.">
          {item && isVideo ? (
            hostable ? (
              <Button
                title="Start a nearby session"
                icon="antenna.radiowaves.left.and.right"
                onPress={() => {
                  closeTogetherSheet();
                  void nearby().host(item);
                }}
              />
            ) : (
              <Text style={s.note}>Download this item to share it nearby.</Text>
            )
          ) : null}
          <Text style={s.label}>Nearby sessions</Text>
          <View style={s.group}>
            {st.hosts.length === 0 ? (
              <View style={s.row}>
                <ActivityIndicator color={c.text3} />
                <Text style={s.rowDetail}>Looking for sessions nearby…</Text>
              </View>
            ) : (
              st.hosts.map((h, i) => (
                <View key={h.peerId} style={[s.row, i < st.hosts.length - 1 && s.rowLine]}>
                  <RowIcon name="antenna.radiowaves.left.and.right" />
                  <View style={s.rowText}>
                    <Text style={s.rowTitle} numberOfLines={1}>
                      {h.advert.itemName || 'A video'}
                    </Text>
                    <Text style={s.rowDetail} numberOfLines={1}>
                      {h.advert.hostName}
                    </Text>
                  </View>
                  <Button title="Join" variant="small" onPress={() => nearby().join(h.peerId)} />
                </View>
              ))
            )}
          </View>
          {st.notice ? <Text style={s.notice}>{st.notice}</Text> : null}
        </Section>
      ) : null}

      {syncPlaySupported && signedIn ? (
        <Section title="On this server (SyncPlay)" footer="Everyone signs in to this Jellyfin server. Works on the web too.">
          {offline ? (
            <Text style={s.note}>SyncPlay needs the server. You are offline.</Text>
          ) : (
            <>
              <Button
                title={item && canSyncPlay(item) ? 'Start a group with this' : 'Start a group'}
                variant="tonal"
                icon="person.2.fill"
                onPress={() => {
                  closeTogetherSheet();
                  void nearby().stopAll();
                  void syncPlay().create(item && canSyncPlay(item) ? item : null);
                }}
              />
              <Text style={s.label}>Groups</Text>
              <View style={s.group}>
                {st.syncplay.loading && !st.syncplay.groups.length ? (
                  <View style={s.row}>
                    <ActivityIndicator color={c.text3} />
                  </View>
                ) : st.syncplay.groups.length === 0 ? (
                  <View style={s.row}>
                    <Text style={s.rowDetail}>No groups on this server yet.</Text>
                  </View>
                ) : (
                  st.syncplay.groups.map((g, i) => (
                    <View key={g.id} style={[s.row, i < st.syncplay.groups.length - 1 && s.rowLine]}>
                      <RowIcon name="person.2.fill" />
                      <View style={s.rowText}>
                        <Text style={s.rowTitle} numberOfLines={1}>
                          {g.name}
                        </Text>
                        <Text style={s.rowDetail} numberOfLines={1}>
                          {[groupStateLabel(g.state), g.participants.join(', ')].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Button
                        title="Join"
                        variant="small"
                        onPress={() => {
                          closeTogetherSheet();
                          void nearby().stopAll();
                          void syncPlay().join(g.id);
                        }}
                      />
                    </View>
                  ))
                )}
              </View>
              {st.syncplay.error ? <Text style={s.notice}>{st.syncplay.error}</Text> : null}
            </>
          )}
        </Section>
      ) : null}
    </>
  );
}

// ---- Nearby session ------------------------------------------------------------

function NearbyView({ st }: { st: TogetherState }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  const phase = st.phase;
  const host = st.role === 'host';

  if (phase.name === 'requesting' || phase.name === 'syncing') {
    return (
      <Section title="Joining">
        <View style={[s.group, s.row]}>
          <ActivityIndicator color={c.text3} />
          <Text style={s.rowDetail}>
            {phase.name === 'requesting' ? `Waiting for ${phase.hostName} to let you in…` : `Connecting to ${phase.hostName}…`}
          </Text>
        </View>
        <Button title="Cancel" variant="tonal" onPress={() => void nearby().stopAll()} />
      </Section>
    );
  }

  if (phase.name === 'ended') {
    return (
      <Section title="Session ended">
        <Text style={s.note}>{phase.message}</Text>
        <Button title="Done" variant="tonal" onPress={() => void nearby().stopAll()} />
      </Section>
    );
  }

  return (
    <>
      {host && st.requests.length ? (
        <Section title="Wants to join">
          <View style={s.group}>
            {st.requests.map((r, i) => (
              <View key={r.inviteId} style={[s.row, i < st.requests.length - 1 && s.rowLine]}>
                <RowIcon name="person.fill" />
                <View style={s.rowText}>
                  <Text style={s.rowTitle} numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text style={s.rowDetail}>{r.have ? 'Has it downloaded' : 'Streams it from you'}</Text>
                </View>
                <Button title="Decline" variant="smallTonal" onPress={() => nearby().respond(r.inviteId, false)} />
                <Button title="Accept" variant="small" onPress={() => nearby().respond(r.inviteId, true)} />
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="People" footer={peopleFooter(st)}>
        <View style={s.group}>
          <View style={[s.row, s.rowLine]}>
            <RowIcon name="person.crop.circle" />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{host ? 'You' : (st.hostName ?? 'Host')}</Text>
              <Text style={s.rowDetail}>Host</Text>
            </View>
          </View>
          {host ? null : (
            <View style={[s.row, st.members.length ? s.rowLine : null]}>
              <RowIcon name="person.fill" />
              <View style={s.rowText}>
                <Text style={s.rowTitle}>You</Text>
                <Text style={s.rowDetail}>{st.source === 'local' ? 'Plays your download' : 'Streams from the host'}</Text>
              </View>
            </View>
          )}
          {st.members.map((m, i, list) => (
            <View key={m.id} style={[s.row, i < list.length - 1 && s.rowLine]}>
              <RowIcon name="person.fill" />
              <View style={s.rowText}>
                <Text style={s.rowTitle} numberOfLines={1}>
                  {m.name}
                </Text>
                <Text style={s.rowDetail}>{[m.local ? 'Own download' : 'Streams from the host', m.buffering ? 'Loading' : null].filter(Boolean).join(' · ')}</Text>
              </View>
            </View>
          ))}
          {host && !st.members.length ? (
            <View style={s.row}>
              <ActivityIndicator color={c.text3} />
              <Text style={s.rowDetail}>Waiting for people nearby to join…</Text>
            </View>
          ) : null}
        </View>
      </Section>

      <Section title="Controls">
        <View style={[s.group, s.row]}>
          <View style={s.rowText}>
            <Text style={s.rowTitle}>Only the host controls</Text>
            <Text style={s.rowDetail}>{st.onlyHostControls ? 'Guests watch; the host plays, pauses and seeks.' : 'Everyone can play, pause, seek and change the speed.'}</Text>
          </View>
          {host ? (
            <Switch value={st.onlyHostControls} onValueChange={(v) => nearby().setOnlyHostControls(v)} trackColor={{ true: c.accent }} />
          ) : (
            <Icon name={st.onlyHostControls ? 'lock.fill' : 'person.2.fill'} size={18} color={c.text2} />
          )}
        </View>
        {st.notice ? <Text style={s.notice}>{st.notice}</Text> : null}
      </Section>

      <Button
        title={host ? 'End session' : 'Leave session'}
        variant="tonal"
        icon="person.2.slash"
        onPress={() => {
          closeTogetherSheet();
          void nearby().stopAll();
        }}
      />
    </>
  );
}

function peopleFooter(st: TogetherState): string | undefined {
  const parts: string[] = [];
  if (st.waiting) parts.push('Waiting while someone loads.');
  if (st.sync && st.role === 'guest') {
    const d = st.sync.drift;
    parts.push(d === null ? 'Syncing…' : Math.abs(d) < 150 ? `In sync (${Math.round(Math.abs(d))} ms)` : `Catching up (${Math.round(d)} ms)`);
  }
  return parts.join(' ') || undefined;
}

// ---- SyncPlay group --------------------------------------------------------------

function GroupView({ st, item }: { st: TogetherState; item: BaseItemDto | null }) {
  const s = useStyles(makeStyles);
  const group = st.syncplay.group!;
  const playingId = usePlayerStore((x) => x.now?.item.Id ?? null);
  return (
    <>
      <Section title="SyncPlay" footer={st.sync ? `Server clock: ${Math.round(st.sync.rtt)} ms round trip.` : undefined}>
        <View style={s.group}>
          <View style={[s.row, s.rowLine]}>
            <RowIcon name="person.2.fill" />
            <View style={s.rowText}>
              <Text style={s.rowTitle}>{groupStateLabel(group.state)}</Text>
              <Text style={s.rowDetail} numberOfLines={2}>
                {group.participants.join(', ') || 'Only you'}
              </Text>
            </View>
          </View>
          <View style={s.row}>
            <Text style={s.rowDetail}>Everyone in the group can play, pause and seek.</Text>
          </View>
        </View>
      </Section>
      {item && canSyncPlay(item) && item.Id !== playingId ? (
        <Button title={`Play “${item.Name ?? 'this'}” for the group`} icon="play.fill" onPress={() => void syncPlay().playInGroup(item)} />
      ) : null}
      {item && canSyncPlay(item) && item.Id === playingId && group.state === 'Idle' ? (
        <Button title="Play this for the group" icon="play.fill" onPress={() => void syncPlay().playInGroup(item)} />
      ) : null}
      <View style={s.buttonRow}>
        <Button title="Previous" variant="tonal" icon="backward.fill" onPress={() => void syncPlay().previous()} containerStyle={{ flex: 1 }} />
        <Button title="Next" variant="tonal" icon="forward.fill" onPress={() => void syncPlay().next()} containerStyle={{ flex: 1 }} />
      </View>
      <Button
        title="Leave group"
        variant="tonal"
        icon="person.2.slash"
        onPress={() => {
          closeTogetherSheet();
          void syncPlay().leave();
        }}
      />
    </>
  );
}

// ---- Parts -----------------------------------------------------------------------

function Section({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  const s = useStyles(makeStyles);
  return (
    <View style={s.section}>
      <Text style={s.header} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      {children}
      {footer ? <Text style={s.footer}>{footer}</Text> : null}
    </View>
  );
}

function RowIcon({ name }: { name: IconName }) {
  const s = useStyles(makeStyles);
  const { c } = useTheme();
  return (
    <View style={s.rowIcon}>
      <Icon name={name} size={16} color={c.text} />
    </View>
  );
}

const makeStyles = createStyles(({ c }: AppTheme) => ({
  section: { gap: spacing.sm },
  header: { ...font(type.footnote), color: c.text2, letterSpacing: 0.4, paddingHorizontal: spacing.xs },
  footer: { ...font(type.footnote), color: c.text2, paddingHorizontal: spacing.xs },
  label: { ...font(type.subheadline), fontWeight: '600' as const, color: c.text, paddingHorizontal: spacing.xs, marginTop: spacing.xs },
  note: { ...font(type.subheadline), color: c.text2, paddingHorizontal: spacing.xs },
  notice: { ...font(type.footnote), color: c.warning, paddingHorizontal: spacing.xs },
  group: { backgroundColor: c.surface, borderRadius: radius.lg, overflow: 'hidden' as const, borderCurve: 'continuous' as const },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing.md,
    minHeight: scaled(sizes.settingsRow + 6),
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.separator },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { ...font(type.body), color: c.text },
  rowDetail: { ...font(type.footnote), color: c.text2, flexShrink: 1 },
  rowIcon: { width: 29, height: 29, borderRadius: 7, backgroundColor: c.surface3, alignItems: 'center' as const, justifyContent: 'center' as const },
  buttonRow: { flexDirection: 'row' as const, gap: spacing.md },
}));
