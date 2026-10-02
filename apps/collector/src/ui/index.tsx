import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  color,
  face,
  icon as iconSize,
  radius,
  size,
  space,
  touch,
  tracking,
  type IconName,
} from "./tokens";

/**
 * The collector's component library. Every screen in this app is built from these.
 *
 * FIVE BEHAVIOURAL RULES survive any restyle, because each one was written after a real
 * failure in a market (see the collector UI constraints and `PRODUCT.md`):
 *   1. No message may name a cause the screen has not checked.
 *   2. A disabled control must say what is missing — enforced below: `Punch`, `Action` and
 *      `Slot` have no `disabled` prop, only `blocked: string | null`.
 *   3. Money is only rendered through `format()`; `Figure` and `Amount` take strings.
 *   4. A sequence-skip warning is confirmable, never a block.
 *   5. Nothing may throw inside a render or an `onChange`.
 *
 * Every control carries a visible text label. Icons sit beside words, never instead of
 * them — the one exception is the app bar's back arrow, which is the platform's own idiom
 * and is labelled for TalkBack.
 */

/** Android's ripple, themed. `Pressable` ignores this prop on other platforms. */
const ripple = (tone: string, borderless = false) => ({
  color: tone,
  borderless,
  foreground: true,
});

/* ------------------------------------------------------------------- icon ---- */

/**
 * One icon family (Material Community Icons, outline weight), sized from tokens.
 *
 * Decorative by default: an icon here always sits beside a word that says the same thing,
 * so TalkBack reads the word and skips the glyph.
 */
export function Icon({
  name,
  size: px = iconSize.md,
  tone = color.ink,
}: {
  name: IconName;
  size?: number;
  tone?: string;
}) {
  return (
    <MaterialCommunityIcons
      name={name}
      size={px}
      color={tone}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** An icon on a tinted rounded square: list rows, tiles, the app bar's mark. */
export function IconTile({
  name,
  tone = color.primary,
  wash = color.primaryWash,
  px = 40,
}: {
  name: IconName;
  tone?: string;
  wash?: string;
  px?: number;
}) {
  return (
    <View
      style={[
        { width: px, height: px, borderRadius: px * 0.3, backgroundColor: wash },
        styles.center,
      ]}
    >
      <Icon name={name} tone={tone} size={px >= 48 ? iconSize.lg : iconSize.md} />
    </View>
  );
}

/* ------------------------------------------------------------------ type ---- */

/**
 * The ink a row imposes on the text inside it: a suppressed or blocked row dims every
 * `Body` and `Label` underneath, whether the caller passed strings or real nodes.
 */
const SlotInk = createContext<string | null>(null);

/** A compact row sets the `Body` inside it at the small size. */
const SlotCompact = createContext(false);

/** Small caps section label. */
export function Label({
  children,
  tone,
}: {
  children: ReactNode;
  tone?: string;
}) {
  const slotInk = useContext(SlotInk);
  return <Text style={[t.label, { color: tone ?? slotInk ?? color.muted }]}>{children}</Text>;
}

/** Body copy. Every message, every explanation. */
export function Body({ children, tone }: { children: ReactNode; tone?: string }) {
  const slotInk = useContext(SlotInk);
  const compact = useContext(SlotCompact);
  return (
    <Text style={[compact ? t.small : t.body, { color: tone ?? slotInk ?? color.ink }]}>
      {children}
    </Text>
  );
}

/** A screen's subject: a stall number, a tenant, a heading. */
export function Title({
  children,
  numberOfLines,
  tone,
}: {
  children: ReactNode;
  numberOfLines?: number;
  tone?: string;
}) {
  const slotInk = useContext(SlotInk);
  return (
    <Text numberOfLines={numberOfLines} style={[t.title, { color: tone ?? slotInk ?? color.ink }]}>
      {children}
    </Text>
  );
}

/** A quiet aside — an empty state, a "loading your booklets" line. */
export function Note({ children, icon }: { children: ReactNode; icon?: IconName }) {
  if (!icon) return <Text style={t.note}>{children}</Text>;
  return (
    <View style={styles.empty}>
      <IconTile name={icon} tone={color.muted} wash={color.sunk} px={56} />
      <Text style={[t.note, { textAlign: "center" }]}>{children}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- chassis ---- */

/**
 * The top app bar: white, fixed, same position and scale on every screen.
 *
 * `register` is the right-hand slot where the honest sync age goes on the screens that owe
 * one. It lives in the bar rather than in the body because a staleness disclosure that
 * scrolls away is a disclosure the collector reads once and never again.
 */
export function RackHead({
  title,
  subtitle,
  register,
  onBack,
  icon,
}: {
  title: string;
  subtitle?: string | null;
  register?: ReactNode;
  onBack?: () => void;
  /** A brand mark for top-level screens that have no Back. */
  icon?: IconName;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[c.head, { paddingTop: insets.top + space.tight }]}>
      <View style={c.headRow}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            android_ripple={ripple(color.sunk, true)}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={4}
            style={({ pressed }) => [c.back, pressed && { backgroundColor: color.sunk }]}
          >
            <Icon name="arrow-left" tone={color.ink} size={iconSize.lg - 2} />
          </Pressable>
        ) : icon ? (
          <IconTile name={icon} tone={color.onPrimary} wash={color.primary} px={40} />
        ) : null}
        <View style={c.headText}>
          <Text style={c.headTitle} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text style={c.headSub} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {register ? <View style={c.headRegister}>{register}</View> : null}
      </View>
    </View>
  );
}

/**
 * The screen chassis: app bar at the top, a ground that scrolls, and the action shelf
 * pinned to the bottom edge inside one-handed thumb reach — a collector holding a receipt
 * booklet in the other hand cannot scroll to find the button that ends the transaction.
 */
export function Screen({
  head,
  children,
  shelf,
  scroll = true,
}: {
  head?: ReactNode;
  children: ReactNode;
  shelf?: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView style={c.flex} contentContainerStyle={c.body} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={[c.flex, c.body]}>{children}</View>
  );

  return (
    <View style={c.screen}>
      {head}
      {body}
      {shelf ? (
        <View style={[c.shelf, { paddingBottom: insets.bottom + space.snug }]}>{shelf}</View>
      ) : null}
    </View>
  );
}

/** A group of related things. */
export function Group({ children, gap = space.snug }: { children: ReactNode; gap?: number }) {
  return <View style={{ gap }}>{children}</View>;
}

/** Vertical space between groups. */
export function Rift({ h = space.rift }: { h?: number }) {
  return <View style={{ height: h }} />;
}

/** A white rounded surface. */
export function Card({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return <View style={[c.card, pad && c.cardPad]}>{children}</View>;
}

/**
 * A card of rows with dividers drawn between them — so a list can never end on a stray
 * rule or start without one. Null children are skipped.
 */
export function List({ children }: { children: ReactNode }) {
  const rows = flatten(children);
  return (
    <View style={c.card}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index > 0 ? <Rule /> : null}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (child === null || child === undefined || child === false) return;
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...flatten((child.props as { children?: ReactNode }).children));
      return;
    }
    out.push(child);
  });
  return out;
}

/** The navy summary card at the top of the shift screen. */
export function Hero({ children }: { children: ReactNode }) {
  return <View style={c.hero}>{children}</View>;
}

/* ----------------------------------------------------------------- figures ---- */

/**
 * The figure the collector copies onto the paper Official Receipt.
 *
 * `value` is ALWAYS the output of `format()` — this component takes a rendered string and
 * never a number, so there is no path through it that could interpolate or round money
 * itself. A null value renders a stated absence rather than a zero, because `₱0.00` is a
 * specific claim about money and an unparseable figure is not that claim.
 */
export function Figure({
  label,
  value,
  tone = "ink",
  absent = "No figure on this tablet.",
  inline = false,
  on = "card",
}: {
  label: string;
  value: string | null;
  tone?: "ink" | "confirmed" | "refusal";
  absent?: string;
  /** Label left, figure right: the shelf's checkout-total layout. */
  inline?: boolean;
  on?: "card" | "hero";
}) {
  const ink =
    on === "hero"
      ? color.onHero
      : tone === "confirmed"
        ? color.confirmed
        : tone === "refusal"
          ? color.refusal
          : color.ink;
  const labelInk = on === "hero" ? color.onHeroMuted : color.muted;
  return (
    <View style={inline ? f.inline : f.panel}>
      <Text style={[t.label, { color: labelInk }, inline && { flexShrink: 1 }]}>{label}</Text>
      {value === null ? (
        <Text style={[t.body, { color: labelInk }]}>{absent}</Text>
      ) : (
        <Text style={[f.figure, { color: ink }]} allowFontScaling>
          {value}
        </Text>
      )}
    </View>
  );
}

/** A secondary money line — a balance, a change figure — at body scale. */
export function Amount({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string | null;
  tone?: "ink" | "confirmed" | "muted";
}) {
  if (value === null) return null;
  const ink = tone === "confirmed" ? color.confirmed : tone === "muted" ? color.muted : color.ink;
  return (
    <View style={f.amountRow}>
      <Label>{label}</Label>
      <Text style={[f.amount, { color: ink }]}>{value}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------- rows ---- */

/**
 * A row in a `List`.
 *
 * `selectable` rows carry a check circle, and `selected` fills the row with the action
 * tint — so a FIFO run of periods reads as one continuous block of ticked rows from the
 * oldest down. `suppressed` drops an unselected row back once a run exists (4.8:1, never a
 * wash: a row a collector cannot read is not a quieter row, it is a missing one).
 *
 * `nav` rows end in a chevron: tapping them goes somewhere.
 *
 * `blocked` is a reason string, never a boolean. See `Punch` for why.
 */
export function Slot({
  onPress,
  selected = false,
  suppressed = false,
  blocked = null,
  selectable = false,
  nav = false,
  compact = false,
  indent = false,
  disclosure,
  icon,
  left,
  right,
  under,
}: {
  onPress?: () => void;
  selected?: boolean;
  suppressed?: boolean;
  blocked?: string | null;
  selectable?: boolean;
  nav?: boolean;
  /** Smaller type and tighter padding, for dense lists such as a lease's periods. */
  compact?: boolean;
  /** Stepped in under a disclosure row, so a month's periods read as belonging to it. */
  indent?: boolean;
  /** A chevron that opens (`closed`) or closes (`open`) the rows beneath this one. */
  disclosure?: "open" | "closed";
  icon?: IconName;
  left: ReactNode;
  right?: ReactNode;
  under?: ReactNode;
}) {
  const dim = blocked !== null || suppressed;
  const ink = dim ? color.suppressed : color.ink;
  return (
    <SlotInk.Provider value={dim ? color.suppressed : null}>
      <SlotCompact.Provider value={compact}>
        <Pressable
          onPress={onPress}
          disabled={!onPress}
          android_ripple={onPress ? ripple(color.primaryWash) : undefined}
          accessibilityRole={onPress ? (selectable ? "checkbox" : "button") : undefined}
          accessibilityState={
            selectable
              ? { checked: selected, disabled: blocked !== null }
              : { selected, disabled: blocked !== null }
          }
          style={({ pressed }) => [
            r.slot,
            compact && r.slotCompact,
            indent && r.slotIndent,
            selected && r.slotOn,
            pressed && onPress && !selected ? r.slotPressed : null,
          ]}
        >
          {disclosure ? (
            <Icon
              name={disclosure === "open" ? "chevron-down" : "chevron-right"}
              tone={dim ? color.suppressed : color.primary}
              size={compact ? iconSize.md : iconSize.lg - 2}
            />
          ) : selectable ? (
            <Icon
              name={selected ? "check-circle" : "checkbox-blank-circle-outline"}
              tone={selected ? color.primary : color.ruleStrong}
              size={compact ? iconSize.md : iconSize.lg - 2}
            />
          ) : icon ? (
            <IconTile
              name={icon}
              tone={dim ? color.suppressed : color.primary}
              wash={dim ? color.sunk : color.primaryWash}
            />
          ) : null}
          <View style={[r.slotBody, compact && r.slotBodyCompact]}>
            <View style={r.slotRow}>
              <View style={r.slotLeft}>
                {typeof left === "string" ? (
                  <Text style={[r.slotText, compact && r.slotTextCompact, { color: ink }]}>{left}</Text>
                ) : (
                  left
                )}
              </View>
              {right ? (
                <View style={r.slotRight}>
                  {typeof right === "string" ? (
                    <Text style={[r.slotAmount, compact && r.slotAmountCompact, { color: ink }]}>{right}</Text>
                  ) : (
                    right
                  )}
                </View>
              ) : null}
            </View>
            {under ? <View>{under}</View> : null}
            {blocked ? (
              <Text style={[t.small, { color: color.refusal }]} accessibilityLiveRegion="polite">
                {blocked}
              </Text>
            ) : null}
          </View>
          {nav ? <Icon name="chevron-right" tone={color.suppressed} /> : null}
        </Pressable>
      </SlotCompact.Provider>
    </SlotInk.Provider>
  );
}

/** A hairline between rows. */
export function Rule() {
  return <View style={r.rule} />;
}

/**
 * A launcher tile: the shift screen's round, laid out as a grid of icon cards the way a
 * banking or wallet app lays out its actions. Always an icon AND a word.
 */
export function Tile({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: IconName;
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      android_ripple={ripple(color.primaryWash)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={({ pressed }) => [c.tile, pressed && { backgroundColor: color.sunk }]}
    >
      <IconTile name={icon} px={48} />
      <View style={{ gap: space.hair }}>
        <Text style={c.tileLabel}>{label}</Text>
        {hint ? <Text style={c.tileHint}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

/** Tiles two to a row. */
export function TileGrid({ children }: { children: ReactNode }) {
  const tiles = flatten(children);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < tiles.length; i += 2) rows.push(tiles.slice(i, i + 2));
  return (
    <View style={{ gap: space.snug }}>
      {rows.map((row, index) => (
        <View key={index} style={c.tileRow}>
          {row.map((tile, j) => (
            <View key={j} style={c.flex}>
              {tile}
            </View>
          ))}
          {row.length === 1 ? <View style={c.flex} /> : null}
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------------- controls ---- */

/**
 * Joins the reasons a control cannot be used, so that when two things are missing the
 * collector is told both rather than whichever was checked first.
 *
 * Returns null when nothing is missing, which is exactly the shape `blocked` wants.
 */
export function missing(...parts: (string | false | null | undefined)[]): string | null {
  const real = parts.filter((p): p is string => typeof p === "string" && p.trim() !== "");
  if (real.length === 0) return null;
  return real.join(" ");
}

/**
 * The primary action. One per screen, on the shelf.
 *
 * THERE IS NO `disabled` PROP, AND THAT IS THE POINT. `blocked` is a reason string: a
 * non-null value both disables the control and states what is missing, so a dead button
 * with no explanation is not something a caller can express. A collector was once
 * stranded in a market by exactly that shape.
 *
 * The reason sits ABOVE the button, inside the shelf: the explanation belongs where the eye
 * already is when it finds the control dead.
 */
export function Punch({
  label,
  onPress,
  blocked = null,
  busy = false,
  busyLabel,
  tone = "primary",
  icon,
}: {
  label: string;
  onPress: () => void;
  blocked?: string | null;
  busy?: boolean;
  busyLabel?: string;
  tone?: "primary" | "quiet" | "danger";
  icon?: IconName;
}) {
  const dead = blocked !== null || busy;
  const fg = blocked
    ? color.suppressed
    : tone === "quiet"
      ? color.primary
      : color.onPrimary;
  return (
    <View style={k.wrap}>
      {blocked ? (
        <View style={k.reasonRow}>
          <Icon name="information-outline" tone={color.muted} size={iconSize.sm} />
          <Text style={k.reason} accessibilityLiveRegion="polite">
            {blocked}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPress={onPress}
        disabled={dead}
        android_ripple={dead ? undefined : ripple("rgba(255,255,255,0.24)")}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={blocked ?? undefined}
        accessibilityState={{ disabled: dead, busy }}
        style={({ pressed }) => [
          k.base,
          blocked
            ? k.stub
            : tone === "quiet"
              ? k.quiet
              : tone === "danger"
                ? k.danger
                : k.filled,
          pressed && !dead && tone === "primary" ? k.filledPressed : null,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={fg} />
        ) : icon ? (
          <Icon name={icon} tone={fg} />
        ) : null}
        <Text style={[k.label, { color: fg }]}>{busy && busyLabel ? busyLabel : label}</Text>
      </Pressable>
    </View>
  );
}

/**
 * A secondary action: sync, retry, sign out. Same `blocked` contract as `Punch`.
 * Outlined, with an icon beside — never instead of — its label.
 */
export function Action({
  label,
  onPress,
  blocked = null,
  busy = false,
  busyLabel,
  tone = "quiet",
  icon,
}: {
  label: string;
  onPress: () => void;
  blocked?: string | null;
  busy?: boolean;
  busyLabel?: string;
  tone?: "quiet" | "danger";
  icon?: IconName;
}) {
  const dead = blocked !== null || busy;
  const fg = dead ? color.suppressed : tone === "danger" ? color.refusal : color.primary;
  return (
    <View style={k.wrap}>
      <Pressable
        onPress={onPress}
        disabled={dead}
        android_ripple={dead ? undefined : ripple(color.primaryWash)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={blocked ?? undefined}
        accessibilityState={{ disabled: dead, busy }}
        style={({ pressed }) => [
          a.base,
          tone === "danger" && a.danger,
          dead && a.dead,
          pressed && !dead ? a.pressed : null,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={fg} />
        ) : icon ? (
          <Icon name={icon} tone={fg} size={iconSize.md - 2} />
        ) : null}
        <Text style={[a.label, { color: fg }]}>{busy && busyLabel ? busyLabel : label}</Text>
      </Pressable>
      {blocked ? (
        <Text style={k.reason} accessibilityLiveRegion="polite">
          {blocked}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A yes-or-no question asked over the screen before something that cannot be taken back.
 *
 * Cancel is the outlined button on the left and only closes; the confirming button carries
 * the verb, so a collector who reads only the buttons still knows what they are agreeing
 * to. Android Back and a tap on the scrim both cancel.
 */
export function Confirm({
  visible,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  icon,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={m.scrim} onPress={onCancel} accessibilityLabel={cancelLabel}>
        {/* A Pressable, not a View, so a tap on the sheet itself does not reach the scrim. */}
        <Pressable style={m.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <Text style={m.title} accessibilityRole="header">
            {title}
          </Text>
          {typeof children === "string" ? (
            <Text style={[t.body, { color: color.muted }]}>{children}</Text>
          ) : (
            children
          )}
          <View style={m.buttons}>
            <Pressable
              onPress={onCancel}
              android_ripple={ripple(color.primaryWash)}
              accessibilityRole="button"
              style={({ pressed }) => [a.base, m.button, pressed ? a.pressed : null]}
            >
              <Text style={[a.label, { color: color.primary }]}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              android_ripple={ripple("rgba(255,255,255,0.24)")}
              accessibilityRole="button"
              style={({ pressed }) => [k.base, k.filled, m.button, pressed ? k.filledPressed : null]}
            >
              {icon ? <Icon name={icon} tone={color.onPrimary} /> : null}
              <Text style={[k.label, { color: color.onPrimary }]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A small inline text button with an icon — "Remove" on a receipt line. */
export function LinkButton({
  label,
  onPress,
  icon,
  tone = "primary",
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  tone?: "primary" | "danger";
  accessibilityLabel?: string;
}) {
  const fg = tone === "danger" ? color.refusal : color.primary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      hitSlop={10}
      android_ripple={ripple(color.sunk)}
      style={({ pressed }) => [a.link, pressed && { backgroundColor: color.sunk }]}
    >
      {icon ? <Icon name={icon} tone={fg} size={iconSize.sm} /> : null}
      <Text style={[t.small, { color: fg, fontFamily: face.bold }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * A stated condition: a refusal, a confirmable warning, a confirmation, a plain notice.
 *
 * `action` is the way out. A refusal with no remedy on it is a dead end, and the one thing
 * this app may never do is strand somebody in a market. The tone is carried by an icon AND
 * a word, never by colour alone.
 */
export function Statement({
  tone,
  children,
  action,
  detail,
}: {
  tone: "refusal" | "warning" | "confirmed" | "notice";
  children: ReactNode;
  action?: ReactNode;
  /**
   * Raw diagnostic text for whoever has to fix it -- a thrown message, a server code.
   * Smaller and quieter than the sentence above it.
   */
  detail?: string | null;
}) {
  const skin =
    tone === "refusal"
      ? { wash: color.refusalWash, rule: color.refusalRule, ink: color.refusal, tag: "Problem", icon: "alert-circle-outline" as const }
      : tone === "warning"
        ? { wash: color.warningWash, rule: color.warningRule, ink: color.warning, tag: "Check", icon: "alert-outline" as const }
        : tone === "confirmed"
          ? { wash: color.confirmedWash, rule: color.confirmedRule, ink: color.confirmed, tag: "Done", icon: "check-circle-outline" as const }
          : { wash: color.card, rule: color.rule, ink: color.muted, tag: null, icon: "information-outline" as const };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[s.box, { backgroundColor: skin.wash, borderColor: skin.rule }]}
    >
      <Icon name={skin.icon} tone={skin.ink} />
      <View style={s.text}>
        {skin.tag ? <Text style={[s.tag, { color: skin.ink }]}>{skin.tag}</Text> : null}
        {typeof children === "string" ? <Text style={[t.body, { color: color.ink }]}>{children}</Text> : children}
        {detail ? <Text style={s.detail}>{detail}</Text> : null}
        {action ? <View style={s.action}>{action}</View> : null}
      </View>
    </View>
  );
}

/** An outlined text field with its label above and an optional leading icon. */
export function Field({
  label,
  voice = "text",
  icon,
  ...rest
}: TextInputProps & { label: string; voice?: "text" | "figure" | "mono"; icon?: IconName }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={i.wrap}>
      <Text style={i.label}>{label}</Text>
      <View style={[i.box, focused && i.boxOn, rest.editable === false && i.boxOff]}>
        {icon ? <Icon name={icon} tone={focused ? color.primary : color.muted} /> : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={color.suppressed}
          {...rest}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          style={[
            i.input,
            voice === "figure" && i.inputFigure,
            voice === "mono" && i.inputMono,
          ]}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ punch ---- */

/**
 * The one celebratory moment: a validated serial settles in with a check. It marks the one
 * genuinely irreversible step in the flow — the receipt about to be committed.
 *
 * Cut to an instant state change when the system's Remove animations setting is on.
 */
export function PunchMark({ serial }: { serial: string }) {
  const [settle] = useState(() => new Animated.Value(0));
  const [reduced, setReduced] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (alive) setReduced(on);
      })
      .catch(() => {
        // An unreadable accessibility setting is not a reason to withhold the mark; treat
        // it as "reduce motion", which is the outcome that is never wrong for anyone.
        if (alive) setReduced(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduced === null) return;
    if (reduced) {
      settle.setValue(1);
      return;
    }
    settle.setValue(0);
    Animated.timing(settle, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [reduced, serial, settle]);

  if (reduced === null) return null;

  return (
    <Animated.View style={[p.card, { opacity: settle }]} accessibilityLiveRegion="polite">
      <Animated.View
        style={{
          transform: [
            { scale: settle.interpolate({ inputRange: [0, 1], outputRange: [1.8, 1] }) },
          ],
        }}
      >
        <IconTile name="check-decagram" tone={color.onPrimary} wash={color.confirmed} px={48} />
      </Animated.View>
      <View style={c.flex}>
        <Text style={p.tag}>In your booklet</Text>
        <Text style={p.serial}>{serial}</Text>
      </View>
    </Animated.View>
  );
}

/**
 * The honest sync age, as a chip in the app bar. Three states, and each says only what the
 * device actually checked — never "not synced" when what it means is "synced, but a while
 * ago".
 */
export function Register({
  state,
  detail,
}: {
  state: "fresh" | "stale" | "never";
  detail?: string | null;
}) {
  const skin =
    state === "fresh"
      ? { ink: color.confirmed, wash: color.confirmedWash, icon: "cloud-check-outline" as const }
      : state === "stale"
        ? { ink: color.warning, wash: color.warningWash, icon: "cloud-alert-outline" as const }
        : { ink: color.refusal, wash: color.refusalWash, icon: "cloud-off-outline" as const };
  return (
    <View style={[g.register, { backgroundColor: skin.wash }]}>
      <Icon name={skin.icon} tone={skin.ink} size={iconSize.sm} />
      <Text style={[g.registerText, { color: skin.ink }]} numberOfLines={2}>
        {detail}
      </Text>
    </View>
  );
}

/* ----------------------------------------------------------------- styles ---- */

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: space.snug, paddingVertical: space.gap },
});

const t = StyleSheet.create({
  label: {
    fontFamily: face.bold,
    fontSize: size.label,
    letterSpacing: tracking,
    textTransform: "uppercase",
  },
  body: { fontFamily: face.text, fontSize: size.body, lineHeight: size.body * 1.45 },
  small: { fontFamily: face.text, fontSize: size.small, lineHeight: size.small * 1.4 },
  title: { fontFamily: face.bold, fontSize: size.title, lineHeight: size.title * 1.25 },
  note: {
    fontFamily: face.text,
    fontSize: size.body,
    lineHeight: size.body * 1.45,
    color: color.muted,
    paddingVertical: space.snug,
  },
});

const c = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  flex: { flex: 1 },
  body: { padding: space.step, paddingBottom: space.rift },
  head: {
    backgroundColor: color.card,
    paddingHorizontal: space.step,
    paddingBottom: space.snug,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  headRow: { flexDirection: "row", alignItems: "center", gap: space.snug, minHeight: touch.min },
  back: {
    width: touch.min,
    height: touch.min,
    borderRadius: touch.min / 2,
    marginLeft: -space.snug,
    alignItems: "center",
    justifyContent: "center",
  },
  headText: { flex: 1, minWidth: 0 },
  headTitle: { fontFamily: face.bold, fontSize: size.title, lineHeight: size.title * 1.2, color: color.ink },
  headSub: { fontFamily: face.text, fontSize: size.small, lineHeight: size.small * 1.35, color: color.muted },
  // flexShrink, never flex:1 on the text inside: this column is sized by its content, so
  // a flexible child resolves to zero width and the register renders as a bare icon with
  // its sentence invisible.
  headRegister: { maxWidth: "46%", flexShrink: 1 },
  shelf: {
    backgroundColor: color.card,
    paddingHorizontal: space.step,
    paddingTop: space.snug + 2,
    borderTopWidth: 1,
    borderTopColor: color.rule,
    gap: space.snug,
    elevation: 8,
    shadowColor: "#0F172A",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
  },
  card: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.rule,
    overflow: "hidden",
  },
  cardPad: { padding: space.step, gap: space.snug },
  hero: {
    backgroundColor: color.hero,
    borderRadius: radius.card + 4,
    padding: space.gap - 4,
    gap: space.snug,
  },
  tileRow: { flexDirection: "row", gap: space.snug },
  tile: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.rule,
    padding: space.step,
    gap: space.snug,
    minHeight: 128,
    overflow: "hidden",
  },
  tileLabel: { fontFamily: face.bold, fontSize: size.body, lineHeight: size.body * 1.3, color: color.ink },
  tileHint: { fontFamily: face.text, fontSize: size.label + 1, lineHeight: (size.label + 1) * 1.35, color: color.muted },
});

const f = StyleSheet.create({
  panel: { gap: space.hair },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.snug,
  },
  figure: {
    fontFamily: face.bold,
    fontSize: size.figure,
    lineHeight: size.figure * 1.15,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.snug,
  },
  amount: { fontFamily: face.bold, fontSize: size.body },
});

const r = StyleSheet.create({
  slot: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: touch.min + 8,
    paddingHorizontal: space.step,
    gap: space.step - 4,
    backgroundColor: color.card,
  },
  // Still 40dp tall: a full-width row stays well clear of a mis-tap at that height.
  slotCompact: { minHeight: 40, paddingHorizontal: space.snug + 2, gap: space.snug },
  slotIndent: { paddingLeft: space.rift + space.hair },
  slotOn: { backgroundColor: color.primaryWash },
  slotPressed: { backgroundColor: color.sunk },
  slotBody: { flex: 1, paddingVertical: space.snug + 2, gap: space.hair },
  slotBodyCompact: { paddingVertical: space.tight, gap: 0 },
  slotRow: { flexDirection: "row", alignItems: "center", gap: space.snug },
  slotLeft: { flex: 1, minWidth: 0 },
  slotRight: { alignItems: "flex-end" },
  slotText: { fontFamily: face.text, fontSize: size.body, lineHeight: size.body * 1.35 },
  slotTextCompact: { fontSize: size.small, lineHeight: size.small * 1.35 },
  slotAmount: { fontFamily: face.bold, fontSize: size.body },
  slotAmountCompact: { fontSize: size.small },
  rule: { height: 1, backgroundColor: color.rule },
});

const m = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "center",
    padding: space.gap,
  },
  sheet: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    padding: space.gap,
    gap: space.step,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
  },
  title: {
    fontFamily: face.bold,
    fontSize: size.title,
    lineHeight: size.title * 1.25,
    color: color.ink,
  },
  buttons: { flexDirection: "row", gap: space.snug, marginTop: space.tight },
  button: { flex: 1 },
});

const k = StyleSheet.create({
  wrap: { gap: space.tight },
  reasonRow: { flexDirection: "row", gap: space.tight, alignItems: "flex-start" },
  reason: {
    flex: 1,
    fontFamily: face.text,
    fontSize: size.small,
    lineHeight: size.small * 1.4,
    color: color.muted,
  },
  base: {
    minHeight: touch.shelf,
    borderRadius: radius.button,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.snug,
    paddingHorizontal: space.step,
    overflow: "hidden",
  },
  filled: { backgroundColor: color.primary },
  filledPressed: { backgroundColor: color.primaryPressed },
  danger: { backgroundColor: color.refusal },
  quiet: { backgroundColor: color.primaryWash },
  stub: { backgroundColor: color.sunk },
  label: { fontFamily: face.bold, fontSize: size.body + 1 },
});

const a = StyleSheet.create({
  base: {
    minHeight: touch.min,
    borderRadius: radius.button,
    borderWidth: 1.5,
    borderColor: color.primary,
    backgroundColor: color.card,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.tight + 2,
    paddingHorizontal: space.step,
    overflow: "hidden",
  },
  danger: { borderColor: color.refusal },
  dead: { borderColor: color.rule, backgroundColor: color.sunk },
  pressed: { backgroundColor: color.primaryWash },
  label: { fontFamily: face.bold, fontSize: size.body },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.hair + 2,
    minHeight: 36,
    paddingHorizontal: space.tight,
    borderRadius: radius.pill,
  },
});

const s = StyleSheet.create({
  box: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: space.step - 2,
    borderRadius: radius.field,
    borderWidth: 1,
    gap: space.snug + 2,
  },
  text: { flex: 1, gap: space.tight - 2 },
  tag: {
    fontFamily: face.bold,
    fontSize: size.label,
    letterSpacing: tracking,
    textTransform: "uppercase",
  },
  detail: {
    fontFamily: face.mono,
    fontSize: size.label,
    lineHeight: size.label * 1.4,
    color: color.muted,
  },
  action: { alignSelf: "flex-start", paddingTop: space.tight },
});

const i = StyleSheet.create({
  wrap: { gap: space.tight + 2 },
  label: { fontFamily: face.bold, fontSize: size.small, color: color.muted },
  box: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.snug,
    backgroundColor: color.card,
    borderRadius: radius.field,
    borderWidth: 1.5,
    borderColor: color.ruleStrong,
    paddingHorizontal: space.step - 2,
    minHeight: touch.shelf,
  },
  boxOn: { borderColor: color.primary, borderWidth: 2, paddingHorizontal: space.step - 2.5 },
  boxOff: { backgroundColor: color.sunk, borderColor: color.rule },
  input: {
    flex: 1,
    fontFamily: face.text,
    fontSize: size.title,
    color: color.ink,
    paddingVertical: space.snug,
  },
  inputFigure: { fontFamily: face.bold, fontSize: size.figure - 8 },
  inputMono: { fontFamily: face.mono, fontSize: size.body, letterSpacing: 1 },
});

const p = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.step - 2,
    padding: space.step - 2,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.confirmedRule,
    backgroundColor: color.confirmedWash,
  },
  tag: {
    fontFamily: face.bold,
    fontSize: size.label,
    letterSpacing: tracking,
    textTransform: "uppercase",
    color: color.confirmed,
  },
  serial: {
    fontFamily: face.bold,
    fontSize: size.title + 2,
    letterSpacing: 0.5,
    color: color.ink,
  },
});

const g = StyleSheet.create({
  register: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.tight - 2,
    paddingHorizontal: space.snug,
    paddingVertical: space.tight - 1,
    borderRadius: radius.pill,
  },
  registerText: {
    flexShrink: 1,
    fontFamily: face.bold,
    fontSize: size.label,
    lineHeight: size.label * 1.3,
  },
});

export { color, face, icon, radius, size, space, touch, type IconName } from "./tokens";
