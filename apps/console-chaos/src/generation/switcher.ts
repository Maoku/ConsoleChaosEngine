/**
 * 世代切替（IMPLEMENTATION_PLAN §5.2.2、GAME_PLAN §5.1 / §5.4、T1-03）。
 *
 * 1 ティックの進行順序（§4.4）の段階 2 を担う。ここが持つのは
 * 「今どの世代か」「切替中か」「強制切替の予告が出ているか」だけで、
 * 演出（ノイズ・帯・アラート音）は**イベントを購読する側**が行う（§5.2.2）。
 *
 * 実装上の決定（本書に明文が無かったため、ここで定める）:
 *
 * - **キューは 1 つだけ持ち、後勝ちにする。** §5.2.2 は「トランジション中も入力を受け付け、
 *   キューに積む」とだけ定める。連打分をすべて積むと 0.35 秒の切替が数珠つなぎになり、
 *   プレイヤーの最後の意思表示が最も遅れて反映される。後勝ちなら押した最後の世代へ最短で着く
 *   （T1-03 の受け入れ条件「連打しても状態が壊れない」）
 * - **強制切替のキューはプレイヤー入力に上書きされない。** ギミック側の切替は必ず着地する。
 *   ただし着地後は自由に切り替えられる（GAME_PLAN §5.4「強制中もプレイヤーの切替入力は受け付ける」）
 * - **切替の開始と同時に現世代が変わる。** トランジションは見た目の混ざりであって、
 *   シミュレーションの真実は瞬時に切り替わる（不変条件 I5）。したがって投影モードの変更に伴う
 *   位置解決（§5.5.3）は `onBeforeSwitch` で行い、2D → 3D の Z 吸着だけが尺をかけて見える
 */
import { createEventBus, type EventBus } from '@/core/events';
import type { System } from '@/core/ecs/system';
import { TICK_MS } from '@/core/time';
import {
  GENERATION_IDS,
  PROFILES,
  type GenerationId,
  type GenerationProfile,
  type ProjectionMode,
} from './profiles';
import {
  advanceTransition,
  beginTransition,
  createTransition,
  isInvulnerable,
  transitionProgress,
  TRANSITION_DURATION_MS,
  type SwitchReason,
  type TransitionState,
} from './transition';

/** 強制切替の予告時間（GAME_PLAN §5.4：1.5 秒前から赤く点滅し、切替先を先出しする） */
export const FORCED_WARNING_MS = 1500;

export interface SwitchEvent {
  from: GenerationId;
  to: GenerationId;
  reason: SwitchReason;
  /** トランジションの尺。2D → 3D の Z 吸着はこの尺に合わせる（§5.5.3） */
  durationMs: number;
  fromProjection: ProjectionMode;
  toProjection: ProjectionMode;
}

export interface ForcedWarningEvent {
  to: GenerationId;
  /** 予告の長さ。UI は点滅の尺に、audio は下降アラート音の尺に使う */
  leadMs: number;
}

export interface SwitcherEvents {
  /** 切替開始の直前。現世代はまだ from */
  'switch:before': SwitchEvent;
  /** トランジション完了。無敵が解ける瞬間でもある */
  'switch:after': SwitchEvent;
  /** 強制切替の予告開始（1.5 秒前） */
  'forced:warning': ForcedWarningEvent;
  /** 予告の取り消し（ギミックが止まった等）。切替は起きない */
  'forced:cancel': { to: GenerationId };
  /** 強制状態の解除。専用の解除音と帯の消滅で明示する（GAME_PLAN §5.4） */
  'forced:release': { generation: GenerationId };
  [key: string]: unknown;
}

export interface SwitcherOptions {
  initial?: GenerationId;
  /** 既存のバスへ相乗りする場合に渡す。省略時は専用のバスを作る */
  bus?: EventBus<SwitcherEvents>;
  /**
   * 切替の直前に呼ぶ。投影モードの変更に伴う位置解決をここへ接続する（§5.5.3）。
   * イベントより先に呼ばれ、ゲームプレイ側の同期的な処理を保証する
   */
  onBeforeSwitch?: (event: SwitchEvent) => void;
  /** トランジション完了時に呼ぶ */
  onAfterSwitch?: (event: SwitchEvent) => void;
}

export interface Switcher {
  /** 現在の世代。切替開始と同時に変わる */
  readonly generation: GenerationId;
  readonly profile: GenerationProfile;
  readonly transition: Readonly<TransitionState>;
  /** 描画へ渡す旧世代。切替中でなければ null（render/pipeline.ts の RenderRequest.from） */
  readonly renderFrom: GenerationId | null;
  /** 描画へ渡す進行度 0..1 */
  readonly blend: number;
  /** 切替中は無敵（GAME_PLAN §5.1） */
  readonly invulnerable: boolean;
  /** 完了待ちの切替。無ければ null */
  readonly pending: GenerationId | null;
  /** 強制状態にあるか（帯の表示条件） */
  readonly forced: boolean;
  /** 強制切替の予告の残り時間。予告が出ていなければ null */
  readonly warningRemainingMs: number | null;
  /** 予告中の切替先。予告が出ていなければ null（UI が行き先を先出しするのに使う。T1-18） */
  readonly warningTo: GenerationId | null;
  readonly events: EventBus<SwitcherEvents>;

  /**
   * 切替を要求する。
   * @returns 受理したら true（現世代と同じで何も起きない場合は false）
   */
  request(to: GenerationId, reason?: SwitchReason): boolean;
  /** 隣接世代へ巡回する（GAME_PLAN §5.1 の Q / E、ゲームパッドの L / R） */
  cycle(delta: number): boolean;
  /** 強制切替を予告付きで予約する（エリア 5 限定。GAME_PLAN §5.4） */
  scheduleForced(to: GenerationId, leadMs?: number): void;
  /** 予告中の強制切替を取り消す。すでに切り替わっていれば何もしない */
  cancelForcedWarning(): void;
  /** 強制状態を解除する */
  releaseForced(): void;
  /** 1 ティック進める（§4.4 の段階 2）。既定は 1 ティック分 */
  advance(dtMs?: number): void;
}

interface PendingSwitch {
  to: GenerationId;
  reason: SwitchReason;
}

/**
 * §4.4 の段階 2（`generation`）へ差し込むシステム。
 * 切替の状態は ECS のコンポーネントではなくワールド外の 1 つの値なので、
 * `world` は使わない。実行位置だけをスケジュールに明示するための薄い関数。
 */
export function switcherSystem(switcher: Switcher): System {
  return () => switcher.advance();
}

export function createSwitcher(options: SwitcherOptions = {}): Switcher {
  const events = options.bus ?? createEventBus<SwitcherEvents>();
  let current: GenerationId = options.initial ?? GENERATION_IDS[0];
  const transition = createTransition(current);

  let pending: PendingSwitch | null = null;
  /** 進行中のトランジションに対応するイベント。完了時に after として再送する */
  let activeEvent: SwitchEvent | null = null;

  let forcedActive = false;
  let warning: { to: GenerationId; remainingMs: number; leadMs: number } | null = null;

  function makeEvent(from: GenerationId, to: GenerationId, reason: SwitchReason): SwitchEvent {
    return {
      from,
      to,
      reason,
      durationMs: TRANSITION_DURATION_MS[reason],
      fromProjection: PROFILES[from].video.projection,
      toProjection: PROFILES[to].video.projection,
    };
  }

  /** 実際に切替を開始する。ここだけが current を書き換える */
  function begin(to: GenerationId, reason: SwitchReason): void {
    const from = current;
    const event = makeEvent(from, to, reason);

    // 位置解決を先に済ませる。イベントの購読者（演出）は解決後の世界を見る
    options.onBeforeSwitch?.(event);
    events.emit('switch:before', event);

    current = to;
    activeEvent = event;
    beginTransition(transition, from, to, reason);
    if (reason === 'forced') forcedActive = true;
  }

  function complete(): void {
    const event = activeEvent;
    activeEvent = null;
    if (!event) return;
    options.onAfterSwitch?.(event);
    events.emit('switch:after', event);
  }

  /** 完了直後に、積んである切替を即座に開始する（§5.2.2） */
  function startPending(): void {
    const next = pending;
    pending = null;
    if (!next) return;
    // 積んだあとに現世代がそこへ着いていれば、切替は不要
    if (next.to === current) return;
    begin(next.to, next.reason);
  }

  function request(to: GenerationId, reason: SwitchReason = 'player'): boolean {
    if (transition.active) {
      // 強制切替のキューはプレイヤー入力で消えない（ギミックの切替は必ず着地する）
      if (pending?.reason === 'forced' && reason === 'player') return false;
      pending = { to, reason };
      return true;
    }
    if (to === current) return false;
    begin(to, reason);
    return true;
  }

  function advance(dtMs: number = TICK_MS): void {
    if (advanceTransition(transition, dtMs)) {
      complete();
      startPending();
    }
    if (warning) {
      warning.remainingMs -= dtMs;
      if (warning.remainingMs <= 0) {
        const to = warning.to;
        warning = null;
        request(to, 'forced');
      }
    }
  }

  return {
    get generation() {
      return current;
    },
    get profile() {
      return PROFILES[current];
    },
    get transition() {
      return transition;
    },
    get renderFrom() {
      return transition.active ? transition.from : null;
    },
    get blend() {
      return transitionProgress(transition);
    },
    get invulnerable() {
      return isInvulnerable(transition);
    },
    get pending() {
      return pending?.to ?? null;
    },
    get forced() {
      return forcedActive;
    },
    get warningRemainingMs() {
      return warning?.remainingMs ?? null;
    },
    get warningTo() {
      return warning?.to ?? null;
    },
    events,
    request,
    cycle(delta): boolean {
      const count = GENERATION_IDS.length;
      const index = GENERATION_IDS.indexOf(current);
      // 予約済みの切替がある間は、その先から数える（連打で行き先が飛ばないように）
      const base = pending ? GENERATION_IDS.indexOf(pending.to) : index;
      const next = GENERATION_IDS[(((base + delta) % count) + count) % count]!;
      return request(next);
    },
    scheduleForced(to, leadMs = FORCED_WARNING_MS): void {
      if (leadMs <= 0) {
        request(to, 'forced');
        return;
      }
      warning = { to, remainingMs: leadMs, leadMs };
      events.emit('forced:warning', { to, leadMs });
    },
    cancelForcedWarning(): void {
      if (!warning) return;
      const to = warning.to;
      warning = null;
      events.emit('forced:cancel', { to });
    },
    releaseForced(): void {
      if (!forcedActive) return;
      forcedActive = false;
      warning = null;
      events.emit('forced:release', { generation: current });
    },
    advance,
  };
}
