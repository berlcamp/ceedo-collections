import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color, face, size, space, spine, touch, tracking } from "./tokens";

/**
 * The rack's vocabulary. Every screen in this app is built from these and nothing else.
 *
 * Read `.impeccable/surfaces/src-app.md` before changing anything here: the five
 * behavioural rules it records are why several of these components have the shapes they
 * have, and two of them are enforced by the types below rather than by remembering.
 */

/**
 * Android's own touch feedback, themed from the rack rather than left at the platform
 * default. Every pressable in this app fed back with opacity or a background swap, which
 * is the iOS idiom -- a fluent Android user reads the absence of a ripple as a dead
 * control. `Pressable` ignores this prop on other platforms, so it needs no guard.
 */
const ripple = (tone: string, borderless = false) => ({
  color: tone,
  borderless,
  foreground: true,
});

/* ------------------------------------------------------------------ type ---- */

/**
 * The ink a slot imposes on the text inside it.
 *
 * A slot can dim its own contents -- suppressed when a run is selected elsewhere, or
 * blocked. That was applied only to `left`/`right` passed as plain strings, so any slot
 * given real nodes (the sign-in collector list, the ambulant line items) rendered at full
 * ink while claiming to be suppressed. Context carries it to every `Body` and `Label`
 * underneath instead, so the state is a property of the slot rather than of how the
 * caller happened to pass its content.
 */
const SlotInk = createContext<string | null>(null);

/** Tracked caps. The label voice, on stock or on the rack board. */
export function Label({
  children,
  on = "stock",
  tone,
}: {
  children: ReactNode;
  on?: "stock" | "rack";
  tone?: string;
}) {
  const slotInk = useContext(SlotInk);
  return (
    <Text
      style={[
        t.label,
        { color: tone ?? slotInk ?? (on === "rack" ? color.onRackMuted : color.muted) },
      ]}
    >
      {children}
    </Text>
  );
}

/** Body copy. Every message, every explanation. */
export function Body({
  children,
  tone,
  on = "stock",
}: {
  children: ReactNode;
  tone?: string;
  on?: "stock" | "rack";
}) {
  const slotInk = useContext(SlotInk);
  return (
    <Text
      style={[
        t.body,
        { color: tone ?? slotInk ?? (on === "rack" ? color.onRack : color.ink) },
      ]}
    >
      {children}
    </Text>
  );
}

/** A screen's subject: a stall number, a tenant, a heading. */
export function Title({
  children,
  on = "stock",
  numberOfLines,
}: {
  children: ReactNode;
  on?: "stock" | "rack";
  numberOfLines?: number;
}) {
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[t.title, { color: on === "rack" ? color.onRack : color.ink }]}
    >
      {children}
    </Text>
  );
}

/** A quiet aside — an empty state, a "loading your booklets" line. */
export function Note({ children }: { children: ReactNode }) {
  return <Text style={t.note}>{children}</Text>;
}

/* ---------------------------------------------------------------- chassis ---- */

/**
 * The rack board strip. The one fixed reference: same position, same scale, every screen.
 *
 * `register` is the right-hand slot, where the honest sync age goes on the screens that
 * owe one. It is deliberately part of the masthead rather than a banner in the body,
 * because a staleness disclosure that scrolls away is a disclosure the collector reads
 * once and never again.
 */
export function RackHead({
  title,
  subtitle,
  register,
  onBack,
}: {
  title: string;
  subtitle?: string | null;
  register?: ReactNode;
  onBack?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[c.head, { paddingTop: insets.top + space.tight }]}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          android_ripple={ripple(color.onRackMuted, true)}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [c.back, pressed && c.backPressed]}
        >
          {/* A word, not a chevron. Every control in this app names its own action. */}
          <Text style={c.backText}>Back</Text>
        </Pressable>
      ) : null}
      <View style={c.headRow}>
        <View style={c.headText}>
          <Title on="rack" numberOfLines={1}>
            {title}
          </Title>
          {subtitle ? (
            <Text style={[t.body, { color: color.onRackMuted }]} numberOfLines={1}>
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
 * The screen chassis: rack board at the top, stock body that scrolls, action shelf pinned
 * to the bottom edge inside one-handed thumb reach.
 *
 * The shelf is pinned rather than placed at the end of the scroll because a collector
 * holding a receipt booklet in the other hand cannot scroll to find the button that ends
 * the transaction.
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
    <ScrollView
      style={c.flex}
      contentContainerStyle={c.body}
      keyboardShouldPersistTaps="handled"
    >
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

/** A group of related things. Sections are separated by void and weight, never by a box. */
export function Group({ children, gap = space.snug }: { children: ReactNode; gap?: number }) {
  return <View style={{ gap }}>{children}</View>;
}

/** Vertical void between groups. */
export function Rift({ h = space.rift }: { h?: number }) {
  return <View style={{ height: h }} />;
}

/* ----------------------------------------------------------------- figures ---- */

/**
 * The fare panel: the figure the collector copies onto the paper Official Receipt.
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
}: {
  label: string;
  value: string | null;
  tone?: "ink" | "confirmed" | "refusal";
  absent?: string;
}) {
  const ink =
    tone === "confirmed" ? color.confirmed : tone === "refusal" ? color.refusal : color.ink;
  return (
    <View style={f.panel}>
      <Label>{label}</Label>
      {value === null ? (
        <Body tone={color.muted}>{absent}</Body>
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
  const ink =
    tone === "confirmed" ? color.confirmed : tone === "muted" ? color.muted : color.ink;
  return (
    <View style={f.amountRow}>
      <Label>{label}</Label>
      <Text style={[f.amount, { color: ink }]}>{value}</Text>
    </View>
  );
}

/* -------------------------------------------------------------------- rack ---- */

/**
 * A slot in the rack.
 *
 * `selected` fills the slot and lights the spine down its left edge; a run of selected
 * slots reads as one continuous ochre edge, which is what makes FIFO a physical property
 * of the screen rather than a rule enforced invisibly in code.
 *
 * `suppressed` drops an unselected slot back once a run exists — suppression, not just
 * highlight. It drops ink to 5.0:1, never to a wash: a slot a collector cannot read is
 * not a quieter slot, it is a missing one.
 *
 * `blocked` is a reason string, never a boolean. See `Punch` for why.
 */
export function Slot({
  onPress,
  selected = false,
  suppressed = false,
  blocked = null,
  left,
  right,
  under,
}: {
  onPress?: () => void;
  selected?: boolean;
  suppressed?: boolean;
  blocked?: string | null;
  left: ReactNode;
  right?: ReactNode;
  under?: ReactNode;
}) {
  const dim = blocked !== null || suppressed;
  const ink = dim ? color.suppressed : color.ink;
  return (
    <SlotInk.Provider value={dim ? color.suppressed : null}>
      <Pressable
        onPress={onPress}
        disabled={!onPress}
        android_ripple={onPress ? ripple(color.ochre) : undefined}
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityState={{ selected, disabled: blocked !== null }}
        style={({ pressed }) => [
          r.slot,
          selected && r.slotOn,
          pressed && onPress ? r.slotPressed : null,
        ]}
      >
        {/*
          The spine lives in the gutter, not in the text column. The slot is pulled left by
          exactly its own width so that everything inside it lands on the same x as the
          body copy and the hairlines above and below -- otherwise every row in the app
          sits fifteen pixels right of the rule that is supposed to bound it.
        */}
        <View style={[r.spine, selected && r.spineOn]} />
        <View style={r.slotBody}>
          <View style={r.slotRow}>
            <View style={r.slotLeft}>
              {typeof left === "string" ? (
                <Text style={[r.slotText, { color: ink }]}>{left}</Text>
              ) : (
                left
              )}
            </View>
            {right ? (
              <View style={r.slotRight}>
                {typeof right === "string" ? (
                  <Text style={[r.slotAmount, { color: ink }]}>{right}</Text>
                ) : (
                  right
                )}
              </View>
            ) : null}
          </View>
          {under ? <View style={r.slotUnder}>{under}</View> : null}
          {blocked ? (
            <Text style={[t.body, r.slotBlocked]} accessibilityLiveRegion="polite">
              {blocked}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </SlotInk.Provider>
  );
}

/** A hairline between slots. */
export function Rule() {
  return <View style={r.rule} />;
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
 * stranded in a market by exactly that shape, and the rule it produced — a disabled
 * control must say what is missing — is enforced here by the type rather than by
 * everyone remembering it at every call site.
 *
 * The reason sits ABOVE the label, inside the shelf, not floating somewhere in the body:
 * the explanation belongs where the eye already is when it finds the control dead.
 */
export function Punch({
  label,
  onPress,
  blocked = null,
  busy = false,
  busyLabel,
  tone = "primary",
}: {
  label: string;
  onPress: () => void;
  blocked?: string | null;
  busy?: boolean;
  busyLabel?: string;
  tone?: "primary" | "quiet" | "danger";
}) {
  const dead = blocked !== null || busy;
  return (
    <View style={k.wrap}>
      {blocked ? (
        <Text style={k.reason} accessibilityLiveRegion="polite">
          {blocked}
        </Text>
      ) : null}
      <Pressable
        onPress={onPress}
        disabled={dead}
        android_ripple={dead ? undefined : ripple(color.rackLift)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={blocked ?? undefined}
        accessibilityState={{ disabled: dead, busy }}
        style={({ pressed }) => [
          k.base,
          tone === "primary" && (blocked ? k.stub : k.filled),
          tone === "quiet" && k.quiet,
          tone === "danger" && (blocked ? k.stub : k.danger),
          pressed && !dead ? k.pressed : null,
        ]}
      >
        {busy ? <ActivityIndicator color={blocked ? color.muted : color.onRack} /> : null}
        <Text
          style={[
            k.label,
            tone === "quiet" && { color: color.rack },
            blocked ? k.labelStub : null,
          ]}
        >
          {busy && busyLabel ? busyLabel : label}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * A secondary action: sync, retry, sign out, go back. Same `blocked` contract as `Punch`.
 * Never an icon — every control in this app carries a permanently visible text label,
 * because an icon a collector has to interpret is a control they cannot be told about.
 */
export function Action({
  label,
  onPress,
  blocked = null,
  busy = false,
  busyLabel,
  tone = "quiet",
}: {
  label: string;
  onPress: () => void;
  blocked?: string | null;
  busy?: boolean;
  busyLabel?: string;
  tone?: "quiet" | "danger";
}) {
  const dead = blocked !== null || busy;
  return (
    <View style={k.wrap}>
      <Pressable
        onPress={onPress}
        disabled={dead}
        android_ripple={dead ? undefined : ripple(color.rack)}
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
          <ActivityIndicator size="small" color={tone === "danger" ? color.refusal : color.rack} />
        ) : null}
        <Text
          style={[
            a.label,
            tone === "danger" && { color: color.refusal },
            dead && { color: color.suppressed },
          ]}
        >
          {busy && busyLabel ? busyLabel : label}
        </Text>
      </Pressable>
      {blocked ? (
        <Text style={a.reason} accessibilityLiveRegion="polite">
          {blocked}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A stated condition: a refusal, a confirmable warning, a confirmation, a plain notice.
 *
 * `action` is the way out. A refusal with no remedy on it is a dead end, and the one thing
 * this app may never do is strand somebody in a market.
 *
 * Warning copy is set in ink on the amber wash, never in amber: amber is 3.4:1 on stock
 * and cannot carry a sentence in daylight.
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
   * Set smaller and quieter than the sentence above it: a collector cannot act on a
   * stack trace, and the office cannot diagnose without one.
   */
  detail?: string | null;
}) {
  /**
   * `tagInk` is separate from `rule` for one reason: amber is 3.3:1 on its own wash at
   * label size, which is under the floor for small text in the daylight this app is
   * built for. `tokens.ts` says amber is a rule and a tag and never body text; a tone tag
   * IS text, and the word that classifies the whole message is the last one that may be
   * the least readable thing on it. Amber keeps the hairline and the tag goes to ink.
   */
  const skin =
    tone === "refusal"
      ? { wash: color.refusalWash, rule: color.refusal, ink: color.refusal, tagInk: color.refusal, tag: "Problem" }
      : tone === "warning"
        ? { wash: color.warningWash, rule: color.warning, ink: color.ink, tagInk: color.ink, tag: "Check" }
        : tone === "confirmed"
          ? { wash: color.confirmedWash, rule: color.confirmed, ink: color.confirmed, tagInk: color.confirmed, tag: "Done" }
          : { wash: color.stockSunk, rule: color.rule, ink: color.ink, tagInk: color.muted, tag: null };

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[s.box, { backgroundColor: skin.wash, borderColor: skin.rule }]}
    >
      {/*
        A TRACKED-CAPS TAG AND A HAIRLINE, NOT A 4PX COLOURED LEFT EDGE.

        The thick left edge is the category's stock alert costume, and here it cost more
        than taste: it spent the rack's spine language on things that are not slots, which
        devalued the one ochre edge that makes a FIFO run readable. The tag also means the
        tone is not carried by colour alone.
      */}
      {skin.tag ? <Text style={[s.tag, { color: skin.tagInk }]}>{skin.tag}</Text> : null}
      {typeof children === "string" ? (
        <Text style={[t.body, { color: skin.ink }]}>{children}</Text>
      ) : (
        children
      )}
      {detail ? <Text style={s.detail}>{detail}</Text> : null}
      {action ? <View style={s.action}>{action}</View> : null}
    </View>
  );
}

/**
 * A text field. A stock inset closed by a thick underline rather than a box, because a
 * boxed input on a screen with no other boxes reads as a card, and there are no cards here.
 */
export function Field({
  label,
  voice = "text",
  ...rest
}: TextInputProps & { label: string; voice?: "text" | "figure" | "mono" }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={i.wrap}>
      <Label>{label}</Label>
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
          focused && i.inputOn,
        ]}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ punch ---- */

/**
 * The signature interaction, and the only motion in the app.
 *
 * A validated serial settles into the spent state with a punch notch — the conductor's
 * punch biting the ticket. It marks the one genuinely irreversible moment in the flow,
 * which is the moment the receipt is about to be committed as a single transaction.
 *
 * Cut to an instant state change when the system's Remove animations setting is on: the
 * mark still appears, it just does not travel.
 */
export function PunchMark({ serial }: { serial: string }) {
  const settle = useRef(new Animated.Value(0)).current;
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
    Animated.timing(settle, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [reduced, serial, settle]);

  if (reduced === null) return null;

  return (
    <View>
      <Rule />
      {/*
        THE SLOT IS WHAT GETS PUNCHED.

        This was a separate green banner with a dot beside it, which is a badge announcing
        a punch rather than a punch. It is now a rack slot in the same geometry as every
        other slot -- the same gutter, the same hairlines -- that settles into spent green
        with a hole bitten through it. The serial is the ticket; the hole is what spends it.

        The hole is drawn, never a glyph, and it sits in the spine gutter where a selected
        run's ochre edge would be, because a spent slot and a selected slot are two states
        of one object.
      */}
      <Animated.View style={[p.slot, { opacity: settle }]}>
        <View style={p.gutter}>
          <Animated.View
            style={[
              p.notch,
              {
                transform: [
                  {
                    scale: settle.interpolate({
                      inputRange: [0, 1],
                      outputRange: [2.2, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
        <View style={p.body}>
          <Text style={p.serial}>{serial}</Text>
          <Text style={p.spent}>Spent</Text>
        </View>
      </Animated.View>
      <Rule />
    </View>
  );
}

/**
 * The honest sync age, in the masthead. Three states, and each says only what the device
 * actually checked — never "not synced" when what it means is "synced, but a while ago".
 */
export function Register({
  state,
  detail,
}: {
  state: "fresh" | "stale" | "never";
  detail?: string | null;
}) {
  const skin =
    state === "fresh" ? color.confirmed : state === "stale" ? color.warning : color.refusal;
  return (
    <View style={g.register}>
      <View style={[g.pip, { backgroundColor: skin }]} />
      <Text style={g.registerText} numberOfLines={2}>
        {detail}
      </Text>
    </View>
  );
}

/* ----------------------------------------------------------------- styles ---- */

const t = StyleSheet.create({
  label: {
    fontFamily: face.condensed,
    fontSize: size.label,
    fontWeight: "700",
    letterSpacing: tracking,
    textTransform: "uppercase",
  },
  body: { fontFamily: face.text, fontSize: size.body, lineHeight: size.body * 1.45 },
  title: { fontFamily: face.condensed, fontSize: size.title, fontWeight: "700" },
  note: {
    fontFamily: face.text,
    fontSize: size.body,
    lineHeight: size.body * 1.45,
    color: color.muted,
    paddingVertical: space.snug,
  },
});

const c = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.stock },
  flex: { flex: 1 },
  body: { padding: space.step, paddingBottom: space.rift },
  head: {
    backgroundColor: color.rack,
    paddingHorizontal: space.step,
    paddingBottom: space.snug,
  },
  headRow: { flexDirection: "row", alignItems: "flex-end", gap: space.snug },
  headText: { flex: 1, minWidth: 0 },
  // flexShrink, never flex:1 on the text inside: this column is sized by its content, so
  // a flexible child resolves to zero width and the register renders as a bare pip with
  // its sentence invisible.
  headRegister: { maxWidth: "46%", flexShrink: 1 },
  back: {
    alignSelf: "flex-start",
    minHeight: touch.min,
    justifyContent: "center",
    paddingRight: space.step,
    marginLeft: -space.tight,
    paddingLeft: space.tight,
  },
  backPressed: { opacity: 0.7 },
  backText: {
    fontFamily: face.condensed,
    fontSize: size.body,
    fontWeight: "700",
    letterSpacing: tracking,
    textTransform: "uppercase",
    color: color.onRackMuted,
  },
  shelf: {
    backgroundColor: color.stock,
    paddingHorizontal: space.step,
    paddingTop: space.snug,
    borderTopWidth: 1,
    borderTopColor: color.rule,
    gap: space.tight,
  },
});

const f = StyleSheet.create({
  panel: { gap: space.hair },
  figure: {
    fontFamily: face.condensed,
    fontSize: size.figure,
    lineHeight: size.figure * 1.1,
    fontWeight: "700",
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.snug,
  },
  amount: { fontFamily: face.text, fontSize: size.body, fontWeight: "700" },
});

const r = StyleSheet.create({
  slot: {
    flexDirection: "row",
    minHeight: touch.min,
    backgroundColor: "transparent",
    // Pulled into the gutter by the spine's own width, so slot content aligns with the
    // body copy and the hairlines rather than sitting indented from them.
    marginLeft: -spine,
  },
  slotOn: { backgroundColor: color.ochreWash },
  slotPressed: { backgroundColor: color.stockSunk },
  spine: { width: spine, backgroundColor: "transparent" },
  spineOn: { backgroundColor: color.ochre },
  slotBody: { flex: 1, paddingVertical: space.snug, gap: space.hair },
  slotRow: { flexDirection: "row", alignItems: "center", gap: space.snug },
  slotLeft: { flex: 1, minWidth: 0 },
  slotRight: { alignItems: "flex-end" },
  slotUnder: { paddingTop: space.hair },
  slotText: { fontFamily: face.text, fontSize: size.body },
  slotAmount: { fontFamily: face.text, fontSize: size.body, fontWeight: "700" },
  slotBlocked: { color: color.refusal, paddingTop: space.hair },
  rule: { height: 1, backgroundColor: color.rule },
});

const k = StyleSheet.create({
  wrap: { gap: space.tight },
  reason: {
    fontFamily: face.text,
    fontSize: size.body,
    lineHeight: size.body * 1.4,
    color: color.ink,
  },
  base: {
    minHeight: touch.shelf,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.snug,
    paddingHorizontal: space.step,
  },
  filled: { backgroundColor: color.rack },
  danger: { backgroundColor: color.refusal },
  quiet: { backgroundColor: color.stockSunk },
  stub: { backgroundColor: color.stockSunk, borderWidth: 1, borderColor: color.rule },
  pressed: { opacity: 0.86 },
  label: {
    fontFamily: face.condensed,
    fontSize: size.body,
    fontWeight: "700",
    letterSpacing: tracking,
    textTransform: "uppercase",
    color: color.onRack,
  },
  labelStub: { color: color.suppressed },
});

const a = StyleSheet.create({
  base: {
    minHeight: touch.min,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: color.rack,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: space.tight,
    paddingHorizontal: space.step,
  },
  danger: { borderColor: color.refusal },
  dead: { borderColor: color.rule },
  pressed: { backgroundColor: color.stockSunk },
  label: {
    fontFamily: face.condensed,
    fontSize: size.body,
    fontWeight: "700",
    letterSpacing: tracking,
    textTransform: "uppercase",
    color: color.rack,
  },
  reason: {
    fontFamily: face.text,
    fontSize: size.body,
    lineHeight: size.body * 1.4,
    color: color.ink,
  },
});

const s = StyleSheet.create({
  /**
   * A BAND, NOT A BOX. With a full hairline rectangle a statement stacked next to the
   * outlined `Action` buttons at near-identical weight, and a notice shaped like a button
   * at 5am in a market is a tap waiting to happen. Hairlines top and bottom only; the
   * outlined rectangle belongs to things that are pressable.
   */
  box: {
    paddingVertical: space.snug,
    paddingHorizontal: space.step,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    gap: space.tight,
  },
  tag: {
    fontFamily: face.condensed,
    fontSize: size.label,
    fontWeight: "700",
    letterSpacing: tracking,
    textTransform: "uppercase",
  },
  detail: {
    fontFamily: face.mono,
    fontSize: size.label,
    lineHeight: size.label * 1.4,
    color: color.suppressed,
  },
  action: { alignSelf: "flex-start" },
});

const i = StyleSheet.create({
  wrap: { gap: space.tight },
  input: {
    fontFamily: face.text,
    fontSize: size.title,
    color: color.ink,
    backgroundColor: color.stockSunk,
    paddingHorizontal: space.snug,
    paddingVertical: space.snug,
    minHeight: touch.min,
    borderBottomWidth: 3,
    borderBottomColor: color.rule,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  inputFigure: { fontFamily: face.condensed, fontSize: size.figure, fontWeight: "700" },
  inputMono: {
    fontFamily: face.mono,
    fontSize: size.body,
    letterSpacing: Platform.OS === "android" ? 1 : 2,
  },
  inputOn: { borderBottomColor: color.ochre },
});

const p = StyleSheet.create({
  /** Same geometry as `Slot`: pulled into the gutter, minimum touch height. */
  slot: {
    flexDirection: "row",
    minHeight: touch.min,
    marginLeft: -spine,
    backgroundColor: color.confirmedWash,
  },
  gutter: {
    width: spine + space.gap,
    alignItems: "center",
    justifyContent: "center",
  },
  /** The punch: a hole bitten clean through the ticket. Drawn, never a glyph. */
  notch: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: color.stock,
    borderWidth: 2,
    borderColor: color.confirmed,
  },
  body: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: space.step,
    paddingVertical: space.snug,
    gap: space.step,
  },
  serial: {
    fontFamily: face.condensed,
    fontSize: size.title,
    fontWeight: "700",
    letterSpacing: tracking,
    color: color.confirmed,
  },
  spent: {
    fontFamily: face.condensed,
    fontSize: size.label,
    fontWeight: "700",
    letterSpacing: tracking,
    textTransform: "uppercase",
    color: color.confirmed,
  },
});

const g = StyleSheet.create({
  register: { flexDirection: "row", alignItems: "flex-start", gap: space.tight },
  pip: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  registerText: {
    flexShrink: 1,
    fontFamily: face.text,
    fontSize: size.label,
    lineHeight: size.label * 1.35,
    color: color.onRackMuted,
    textAlign: "right",
  },
});

export { color, face, size, space, touch } from "./tokens";
