import { describe, it, expect } from 'vitest';
import { createSwitcher, switcherSystem, FORCED_WARNING_MS, type SwitchEvent } from '@/generation/switcher';
import { createSchedule } from '@/core/ecs/system';
import { createWorld } from '@/core/ecs/world';
import { TRANSITION_DURATION_MS } from '@/generation/transition';
import { GENERATION_IDS, PROFILES, type GenerationId } from '@/generation/profiles';
import { TICK_MS } from '@/core/time';

const PLAYER_MS = TRANSITION_DURATION_MS.player;
const FORCED_MS = TRANSITION_DURATION_MS.forced;

/** ミリ秒ぶんティックを進める（実際のループと同じ刻みで進めることを保つ） */
function run(switcher: ReturnType<typeof createSwitcher>, ms: number): void {
  const ticks = Math.ceil(ms / TICK_MS);
  for (let i = 0; i < ticks; i++) switcher.advance();
}

describe('generation/switcher（T1-03）', () => {
  it('初期状態では切替中ではなく、無敵でもない', () => {
    const s = createSwitcher({ initial: 'FC' });
    expect(s.generation).toBe('FC');
    expect(s.transition.active).toBe(false);
    expect(s.invulnerable).toBe(false);
    expect(s.blend).toBe(1);
    expect(s.renderFrom).toBeNull();
  });

  it('切替開始と同時に現世代が変わり、見た目だけが 0.35 秒かけて混ざる', () => {
    const s = createSwitcher({ initial: 'FC' });
    expect(s.request('PS1')).toBe(true);

    // シミュレーションの真実は瞬時に切り替わる（不変条件 I5）
    expect(s.generation).toBe('PS1');
    expect(s.transition.durationMs).toBe(PLAYER_MS);
    expect(s.renderFrom).toBe('FC');
    expect(s.blend).toBe(0);

    s.advance(PLAYER_MS / 2);
    expect(s.blend).toBeCloseTo(0.5, 6);
    expect(s.renderFrom).toBe('FC');

    s.advance(PLAYER_MS / 2);
    expect(s.transition.active).toBe(false);
    expect(s.blend).toBe(1);
    expect(s.renderFrom).toBeNull();
    expect(s.generation).toBe('PS1');
  });

  it('切替中は無敵で、完了した瞬間に無敵が解ける（GAME_PLAN §5.1）', () => {
    const s = createSwitcher({ initial: 'FC' });
    s.request('SFC');
    expect(s.invulnerable).toBe(true);
    run(s, PLAYER_MS - TICK_MS);
    expect(s.invulnerable).toBe(true);
    run(s, TICK_MS * 2);
    expect(s.invulnerable).toBe(false);
  });

  it('同じ世代への切替は何も起こさない', () => {
    const s = createSwitcher({ initial: 'SFC' });
    expect(s.request('SFC')).toBe(false);
    expect(s.transition.active).toBe(false);
  });

  it('before / after のフックとイベントが 1 回ずつ、正しい順序で発火する', () => {
    const order: string[] = [];
    const before: SwitchEvent[] = [];
    const after: SwitchEvent[] = [];
    const s = createSwitcher({
      initial: 'FC',
      onBeforeSwitch: (e) => {
        before.push(e);
        // フックの時点ではまだ現世代は from（位置解決を旧状態で行える）
        order.push(`hook:before:${s.generation}`);
      },
      onAfterSwitch: (e) => {
        after.push(e);
        order.push(`hook:after:${s.generation}`);
      },
    });
    s.events.on('switch:before', () => order.push('event:before'));
    s.events.on('switch:after', () => order.push('event:after'));

    s.request('PS2');
    run(s, PLAYER_MS);

    expect(order).toEqual(['hook:before:FC', 'event:before', 'hook:after:PS2', 'event:after']);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(before[0]).toMatchObject({
      from: 'FC',
      to: 'PS2',
      reason: 'player',
      durationMs: PLAYER_MS,
      fromProjection: 'ortho2d',
      toProjection: 'perspective3d',
    });
    // after は開始時と同じ内容（購読側が from を知らないと演出を閉じられない）
    expect(after[0]).toEqual(before[0]);
  });

  it('トランジション中の入力はキューに積まれ、完了と同時に次の切替が始まる（§5.2.2）', () => {
    const s = createSwitcher({ initial: 'FC' });
    s.request('SFC');
    run(s, PLAYER_MS / 2);
    expect(s.request('PS1')).toBe(true);
    expect(s.pending).toBe('PS1');
    // 積んでいる間は現世代も演出も変わらない
    expect(s.generation).toBe('SFC');

    run(s, PLAYER_MS);
    expect(s.generation).toBe('PS1');
    expect(s.transition.active).toBe(true);
    expect(s.renderFrom).toBe('SFC');
    expect(s.pending).toBeNull();
  });

  it('キューは後勝ち。連打しても最後に押した世代へ最短で着く', () => {
    const s = createSwitcher({ initial: 'FC' });
    s.request('SFC');
    s.request('PS1');
    s.request('PS2');
    s.request('SFC');
    expect(s.pending).toBe('SFC');

    run(s, PLAYER_MS * 2 + TICK_MS);
    expect(s.generation).toBe('SFC');
    expect(s.transition.active).toBe(false);
  });

  it('積んだ切替の行き先が現世代と同じなら、余計な切替は起きない', () => {
    const s = createSwitcher({ initial: 'FC' });
    s.request('SFC');
    s.request('FC'); // 押し戻し
    s.request('SFC'); // やっぱり進む
    run(s, PLAYER_MS * 2);
    expect(s.generation).toBe('SFC');
    expect(s.transition.active).toBe(false);
    expect(s.pending).toBeNull();
  });

  it('連打しても状態が壊れない（T1-03 の受け入れ条件）', () => {
    const s = createSwitcher({ initial: 'FC' });
    let switchesStarted = 0;
    let switchesCompleted = 0;
    s.events.on('switch:before', () => switchesStarted++);
    s.events.on('switch:after', () => switchesCompleted++);

    // 決定的な擬似乱数で 600 ティック分（10 秒）叩き続ける
    let seed = 12345;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let tick = 0; tick < 600; tick++) {
      if (next() < 0.4) {
        const id = GENERATION_IDS[Math.floor(next() * GENERATION_IDS.length)]!;
        s.request(id);
      }
      s.advance();

      expect(GENERATION_IDS).toContain(s.generation);
      expect(s.blend).toBeGreaterThanOrEqual(0);
      expect(s.blend).toBeLessThanOrEqual(1);
      // 切替中なら旧世代と新世代は必ず異なる（同一世代への「切替」は存在しない）
      if (s.transition.active) {
        expect(s.transition.from).not.toBe(s.transition.to);
        expect(s.transition.to).toBe(s.generation);
        expect(s.invulnerable).toBe(true);
      } else {
        expect(s.renderFrom).toBeNull();
        expect(s.blend).toBe(1);
      }
      // 開始と完了の差は高々 1（同時に 2 つのトランジションが走らない）
      expect(switchesStarted - switchesCompleted).toBeLessThanOrEqual(1);
    }

    run(s, PLAYER_MS * 2);
    expect(s.transition.active).toBe(false);
    expect(switchesCompleted).toBe(switchesStarted);
  });

  it('cycle は隣接世代へ巡回し、端で折り返す', () => {
    const s = createSwitcher({ initial: 'FC' });
    s.cycle(-1);
    expect(s.generation).toBe('PS2');
    run(s, PLAYER_MS);
    s.cycle(1);
    expect(s.generation).toBe('FC');
  });

  it('cycle の連打は予約済みの行き先から数える（行き先が飛ばない）', () => {
    const s = createSwitcher({ initial: 'FC' });
    s.cycle(1); // FC -> SFC（開始）
    s.cycle(1); // SFC -> PS1（予約）
    s.cycle(1); // PS1 -> PS2（予約の置き換え）
    expect(s.pending).toBe('PS2');
    run(s, PLAYER_MS * 2);
    expect(s.generation).toBe('PS2');
  });
});

describe('generation/switcher の強制切替（GAME_PLAN §5.4）', () => {
  it('1.5 秒前に予告を出し、時間どおりに 0.6 秒かけて切り替わる', () => {
    const s = createSwitcher({ initial: 'PS1' });
    const warnings: GenerationId[] = [];
    s.events.on('forced:warning', (e) => {
      warnings.push(e.to);
      expect(e.leadMs).toBe(FORCED_WARNING_MS);
    });

    s.scheduleForced('FC');
    expect(warnings).toEqual(['FC']);
    expect(s.warningRemainingMs).toBe(FORCED_WARNING_MS);
    // 予告中はまだ切り替わらない
    run(s, FORCED_WARNING_MS - TICK_MS * 2);
    expect(s.generation).toBe('PS1');
    expect(s.forced).toBe(false);

    run(s, TICK_MS * 3);
    expect(s.generation).toBe('FC');
    expect(s.forced).toBe(true);
    expect(s.warningRemainingMs).toBeNull();
    expect(s.transition.reason).toBe('forced');
    expect(s.transition.durationMs).toBe(FORCED_MS);
    expect(s.invulnerable).toBe(true);
  });

  it('強制切替の瞬間も無敵で、強制が直接の死因にならない（§5.4 の安全性）', () => {
    const s = createSwitcher({ initial: 'PS2' });
    s.scheduleForced('FC', 0); // 予告なしの即時強制でも無敵は保たれる
    expect(s.invulnerable).toBe(true);
    expect(s.transition.durationMs).toBe(FORCED_MS);
    run(s, FORCED_MS - TICK_MS);
    expect(s.invulnerable).toBe(true);
    run(s, TICK_MS * 2);
    expect(s.invulnerable).toBe(false);
  });

  it('強制中もプレイヤーの切替入力を受け付ける（一時的に戻せる）', () => {
    const s = createSwitcher({ initial: 'PS2' });
    s.scheduleForced('FC', 0);
    run(s, FORCED_MS);
    expect(s.forced).toBe(true);

    expect(s.request('PS2')).toBe(true);
    run(s, PLAYER_MS);
    expect(s.generation).toBe('PS2');
    // 帯は出たまま。ギミック側が再び引き戻すまで強制状態は続く
    expect(s.forced).toBe(true);

    // ギミックの引き戻し
    s.scheduleForced('FC', 0);
    run(s, FORCED_MS);
    expect(s.generation).toBe('FC');
  });

  it('予告中のプレイヤー切替は妨げられない', () => {
    const s = createSwitcher({ initial: 'PS2' });
    s.scheduleForced('FC');
    s.request('PS1');
    expect(s.generation).toBe('PS1');
    run(s, FORCED_WARNING_MS);
    // 予告の時間が来れば、どこに居ても強制先へ引き戻される
    expect(s.generation).toBe('FC');
    expect(s.transition.reason).toBe('forced');
  });

  it('キューに積まれた強制切替はプレイヤー入力に上書きされない', () => {
    const s = createSwitcher({ initial: 'PS2' });
    s.request('PS1'); // 通常切替が進行中
    s.scheduleForced('FC', 0); // 進行中なのでキューへ
    expect(s.pending).toBe('FC');
    expect(s.request('SFC')).toBe(false);
    expect(s.pending).toBe('FC');

    run(s, PLAYER_MS);
    expect(s.generation).toBe('FC');
    expect(s.transition.reason).toBe('forced');
  });

  it('予告は取り消せる。取り消したら切替は起きない', () => {
    const s = createSwitcher({ initial: 'SFC' });
    let cancelled = 0;
    s.events.on('forced:cancel', () => cancelled++);
    s.scheduleForced('FC');
    run(s, FORCED_WARNING_MS / 2);
    s.cancelForcedWarning();
    expect(cancelled).toBe(1);
    run(s, FORCED_WARNING_MS * 2);
    expect(s.generation).toBe('SFC');
    expect(s.forced).toBe(false);
    // 予告が出ていないときの取り消しは何も起こさない
    s.cancelForcedWarning();
    expect(cancelled).toBe(1);
  });

  it('強制状態の解除は 1 度だけイベントを出す', () => {
    const s = createSwitcher({ initial: 'PS1' });
    let released = 0;
    s.events.on('forced:release', () => released++);
    s.releaseForced(); // 強制状態でないので何も起きない
    expect(released).toBe(0);

    s.scheduleForced('FC', 0);
    run(s, FORCED_MS);
    s.releaseForced();
    s.releaseForced();
    expect(released).toBe(1);
    expect(s.forced).toBe(false);
  });
});

describe('generation/switcher のスケジュール接続（§4.4 の段階 2）', () => {
  it('generation 段階に登録され、ゲームプレイより前に進む', () => {
    const schedule = createSchedule();
    const world = createWorld();
    const s = createSwitcher({ initial: 'FC' });
    const order: string[] = [];

    schedule.add('generation', 'switcher', switcherSystem(s));
    schedule.add('gameplay', 'observe', () => {
      // ゲームプレイは「この 1 ティックの世代」を確定した状態で走る
      order.push(`${s.generation}:${s.transition.active ? 'switching' : 'stable'}`);
    });
    expect(schedule.describe()).toEqual(['generation: switcher', 'gameplay: observe']);

    s.request('PS1');
    const ticks = Math.ceil(PLAYER_MS / TICK_MS);
    for (let tick = 0; tick <= ticks; tick++) schedule.run(world, tick);

    expect(order[0]).toBe('PS1:switching');
    expect(order.at(-1)).toBe('PS1:stable');
  });
});

describe('generation/switcher と投影モード（§5.5.3 の接続点）', () => {
  it('切替イベントが投影モードの変化を伝える（位置解決はこれを見て行う）', () => {
    const seen: SwitchEvent[] = [];
    const s = createSwitcher({ initial: 'FC', onBeforeSwitch: (e) => seen.push(e) });

    s.request('SFC'); // 2D -> 2D（投影は変わらない）
    run(s, PLAYER_MS);
    s.request('PS1'); // 2D -> 3D（Z 吸着が要る）
    run(s, PLAYER_MS);
    s.request('FC'); // 3D -> 2D（押し出しが要る）
    run(s, PLAYER_MS);

    expect(seen.map((e) => `${e.fromProjection}->${e.toProjection}`)).toEqual([
      'ortho2d->ortho2d',
      'ortho2d->perspective3d',
      'perspective3d->ortho2d',
    ]);
    // durationMs は Z 吸着の尺として使う。プロファイルの値と食い違わないこと
    for (const event of seen) {
      expect(event.durationMs).toBe(PLAYER_MS);
      expect(event.fromProjection).toBe(PROFILES[event.from].video.projection);
      expect(event.toProjection).toBe(PROFILES[event.to].video.projection);
    }
  });
});
