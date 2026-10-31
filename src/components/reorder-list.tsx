/**
 * A list whose rows reorder by drag (design system §7.10): drag the handle
 * or long-press a row, the other rows make room with the `smooth` spring,
 * and `onMove(from, to)` runs on drop (`to` is the final index). Rows have a
 * fixed height. Screen readers get Move up and Move down actions. TV has no
 * drag: the handle is a Move button with a menu of moves (lib/reorder-moves).
 */
import * as Haptics from 'expo-haptics';
import { type ComponentRef, memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type AccessibilityActionEvent, Platform, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { type SharedValue, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { focusView } from '@/features/tv/focus';
import { reorderMoves } from '@/lib/reorder-moves';
import { isTV } from '@/platform/tv';
import { motion, radius, useTheme } from '@/theme';

import { Icon } from './icon';
import { OptionSheet } from './option-sheet';
import { Touchable } from './touchable';

function pickUpHaptic() {
  if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

export function ReorderList<T>({
  rows,
  rowKey,
  rowHeight,
  renderRow,
  onMove,
  label,
}: {
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  rowHeight: number;
  /** Renders a row; put `handle` at its trailing end. */
  renderRow: (row: T, index: number, handle: ReactNode) => ReactNode;
  onMove: (from: number, to: number) => void;
  /** For the accessibility actions ("Move {label} up"). */
  label?: (row: T) => string;
}) {
  const active = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const count = useSharedValue(rows.length);
  const dropping = useSharedValue(false);
  const keys = rows.map(rowKey).join('|');
  useLayoutEffect(() => {
    count.set(rows.length);
    active.set(-1);
    dragY.set(0);
    dropping.set(false);
  }, [keys, rows.length, count, active, dragY, dropping]);
  const target = useDerivedValue(() => {
    const a = active.get();
    if (a < 0) return -1;
    return Math.min(count.get() - 1, Math.max(0, a + Math.round(dragY.get() / rowHeight)));
  });
  const commit = (from: number, to: number) => {
    if (from !== to) onMove(from, to);
    else {
      active.set(-1);
      dragY.set(0);
      dropping.set(false);
    }
  };
  // TV: the row whose move menu is open, and the row that moved last (its Move button keeps the focus).
  const [menu, setMenu] = useState<number | null>(null);
  const [moved, setMoved] = useState<string | null>(null);
  const menuRow = menu !== null ? rows[menu] : undefined;
  return (
    <View>
      {rows.map((r, i) => (
        <DragRow
          key={rowKey(r, i)}
          position={i}
          total={rows.length}
          rowHeight={rowHeight}
          active={active}
          dragY={dragY}
          dropping={dropping}
          target={target}
          onCommit={commit}
          onMenu={setMenu}
          refocus={moved === rowKey(r, i)}
          name={label?.(r) ?? `item ${i + 1}`}>
          {(handle) => renderRow(r, i, handle)}
        </DragRow>
      ))}
      {isTV ? (
        <OptionSheet
          visible={menu !== null && !!menuRow}
          title={menuRow ? `Move ${label?.(menuRow) ?? 'item'}` : 'Move'}
          options={menu !== null ? reorderMoves(menu, rows.length).map((m) => ({ value: m.to, label: m.label })) : []}
          selected={[]}
          onSelect={(to) => {
            if (menu === null || to === menu || !menuRow) return;
            setMoved(rowKey(menuRow, menu));
            onMove(menu, to);
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </View>
  );
}

const DragRow = memo(function DragRow({
  position,
  total,
  rowHeight,
  active,
  dragY,
  dropping,
  target,
  onCommit,
  onMenu,
  refocus,
  name,
  children,
}: {
  position: number;
  total: number;
  rowHeight: number;
  active: SharedValue<number>;
  dragY: SharedValue<number>;
  dropping: SharedValue<boolean>;
  target: SharedValue<number>;
  onCommit: (from: number, to: number) => void;
  onMenu: (position: number) => void;
  /** TV: this row just moved; its Move button takes the focus back. */
  refocus: boolean;
  name: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const reduced = useReducedMotion();
  const { c } = useTheme();
  const begin = () => {
    'worklet';
    if (dropping.get()) return;
    active.set(position);
    dragY.set(0);
    scheduleOnRN(pickUpHaptic);
  };
  const end = () => {
    'worklet';
    if (active.get() !== position || dropping.get()) return;
    dropping.set(true);
    const to = target.get();
    dragY.set(withSpring((to - position) * rowHeight, motion.spring.smooth));
    scheduleOnRN(onCommit, position, to);
  };
  const handleDrag = Gesture.Pan()
    .onBegin(begin)
    .onUpdate((e) => dragY.set(e.translationY))
    .onEnd(end)
    .onFinalize((_e, ok) => {
      if (!ok && !dropping.get()) {
        active.set(-1);
        dragY.set(0);
      }
    });
  const longPress = Gesture.Pan().activateAfterLongPress(350).onStart(begin).onUpdate((e) => dragY.set(e.translationY)).onEnd(end);

  const style = useAnimatedStyle(() => {
    const a = active.get();
    if (a === position) return { transform: [{ translateY: dragY.get() }, { scale: reduced ? 1 : 1.02 }], zIndex: 10, opacity: 0.96 };
    if (a < 0) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0, opacity: 1 };
    const t = target.get();
    const shift = a < position && position <= t ? -rowHeight : t <= position && position < a ? rowHeight : 0;
    return { transform: [{ translateY: reduced ? shift : withSpring(shift, motion.spring.smooth) }, { scale: 1 }], zIndex: 0, opacity: 1 };
  });

  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'moveUp' && position > 0) onCommit(position, position - 1);
    if (e.nativeEvent.actionName === 'moveDown' && position < total - 1) onCommit(position, position + 1);
  };

  // TV: a moved row is a new native view at its new place; the focus would go back to the top of the page.
  const moveButton = useRef<ComponentRef<typeof View> | null>(null);
  useEffect(() => {
    if (!isTV || !refocus) return;
    const t = setTimeout(() => focusView(moveButton.current), 50);
    return () => clearTimeout(t);
  }, [refocus, position]);

  const handle = isTV ? (
    <Touchable
      ref={moveButton}
      kind="icon"
      radius={radius.pill}
      onPress={() => onMenu(position)}
      style={styles.handle}
      accessibilityRole="button"
      accessibilityLabel={`Move ${name}`}>
      <Icon name="arrow.up.arrow.down" size={18} color={c.text2} />
    </Touchable>
  ) : (
    <GestureDetector gesture={handleDrag}>
      <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon name="line.3.horizontal" size={18} color={c.text3} />
      </View>
    </GestureDetector>
  );

  return (
    <Animated.View
      style={[{ height: rowHeight, backgroundColor: c.bg }, style]}
      accessibilityActions={[
        { name: 'moveUp', label: `Move ${name} up` },
        { name: 'moveDown', label: `Move ${name} down` },
      ]}
      onAccessibilityAction={onAction}>
      <GestureDetector gesture={longPress}>
        <View style={styles.fill}>{children(handle)}</View>
      </GestureDetector>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  handle: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
