import { describe, it, expect } from 'vitest';
import {
  ATTACK_COOLDOWN_TICKS,
  ATTACK_REACH,
  ATTACK_TICKS,
  CHARGE_FULL_MS,
  JUMP_SPEED,
  LOCK_ON_RANGE,
  LockTarget,
  PlayerBody,
  PlayerState,
  VARIABLE_JUMP_CUT,
  WALL_JUMP_PUSH,
  attackBox,
  playerSystem,
  updatePlayer,
  type PlayerBodyData,
  type PlayerStateData,
} from '@/gameplay/player';
import { overlaps, aabbFromCenter } from '@/gameplay/projection';
import { TICK_MS, createWorld, type World } from '@console-chaos/engine';
import {
  createConsoleChaosActionMap,
  type ConsoleChaosActionSnapshot,
} from '@/config/actions';
import { BUFFER_FRAMES } from '@/input/buffer';
import { GENERATION_IDS, GENERATION_VIEWS, type GenerationId } from '../generations';
import { sampleActions, type TestActionInput } from './session-testkit';

/** 1 体のプレイヤーと、その世代の入力経路を持つ試験台 */
function harness(generation: GenerationId) {
  const world: World = createWorld();
  const entity = world.create();
  const body = world.add(entity, PlayerBody);
  const state = world.add(entity, PlayerState);
  const actions = createConsoleChaosActionMap();
  let current: GenerationId = generation;

  /** 生入力 → 制約適用 → 1 ティック分の更新。実際の §4.4 と同じ順序で通す */
  function tick(raw: Partial<TestActionInput> = {}): ConsoleChaosActionSnapshot {
    const profile = GENERATION_VIEWS[current];
    const snapshot = sampleActions(actions, current, raw, TICK_MS);
    updatePlayer(world, body, state, { snapshot, profile });
    return snapshot;
  }

  return {
    world,
    entity,
    body,
    state,
    tick,
    switchTo(next: GenerationId): void {
      current = next;
    },
    get profile() {
      return GENERATION_VIEWS[current];
    },
  };
}

describe('gameplay/player の移動（GAME_PLAN §5.3）', () => {
  it('速度はプロファイルの moveSpeed に従う', () => {
    for (const id of GENERATION_IDS) {
      const player = harness(id);
      // 入力はカメラ相対（T2-08）なので、どの軸へ出るかは構図しだい。
      // どの世代でも「倒し切ったときの速さ」が moveSpeed であることは変わらない
      player.tick({ move: [1, 0] });
      const speed = Math.hypot(player.body.velocity[0], player.body.velocity[2]);
      expect(speed, id).toBeCloseTo(GENERATION_VIEWS[id].theme.action.moveSpeed, 6);
    }
  });

  it('入力はカメラ相対に読み替えられる（T2-08）', () => {
    // 背後視点の第4世代：奥へ倒すと画面の奥（通路の +X）へ進む
    const behind = harness('PS2');
    const speed = GENERATION_VIEWS.PS2.theme.action.moveSpeed;
    behind.tick({ move: [0, -1] });
    expect(behind.body.velocity[0]).toBeCloseTo(speed, 6);
    expect(behind.body.velocity[2]).toBeCloseTo(0, 6);
    expect(behind.state.facing).toBe(1);

    // 画面の右へ倒すと真横（+Z）へ流れる。進んだ向きは変わらないので向きも据え置き
    behind.tick({ move: [1, 0] });
    expect(behind.body.velocity[0]).toBeCloseTo(0, 6);
    expect(behind.body.velocity[2]).toBeCloseTo(speed, 6);
    expect(behind.state.facing).toBe(1);

    // 手前へ倒すとカメラの方へ戻ってくる。向きだけが反転する（カメラは固定）
    behind.tick({ move: [0, 1] });
    expect(behind.body.velocity[0]).toBeCloseTo(-speed, 6);
    expect(behind.state.facing).toBe(-1);

    // 真横から見る世代は改訂前と同じ：入力の左右がそのままワールドの X
    const sideOn = harness('PS1');
    sideOn.tick({ move: [1, 0] });
    expect(sideOn.body.velocity[0]).toBeCloseTo(GENERATION_VIEWS.PS1.theme.action.moveSpeed, 6);
    expect(sideOn.body.velocity[2]).toBeCloseTo(0, 6);
  });

  it('アナログの世代だけが速度可変になる（微調整）', () => {
    // 半分だけ倒した入力
    const analog = harness('PS1');
    analog.tick({ move: [0.5, 0] });
    expect(analog.body.velocity[0]).toBeCloseTo(GENERATION_VIEWS.PS1.theme.action.moveSpeed * 0.5, 6);

    // 方向キー相当の世代では符号に落ちるため、常に最高速度
    const digital = harness('SFC');
    digital.tick({ move: [0.5, 0] });
    expect(digital.body.velocity[0]).toBeCloseTo(GENERATION_VIEWS.SFC.theme.action.moveSpeed, 6);
  });

  it('2D 投影の世代では奥行きへ動けない（§5.5.1）', () => {
    const fc = harness('FC');
    fc.tick({ move: [0, 1] });
    expect(fc.body.velocity[2]).toBe(0);

    const ps1 = harness('PS1');
    ps1.tick({ move: [0, 1] });
    expect(ps1.body.velocity[2]).toBeCloseTo(GENERATION_VIEWS.PS1.theme.action.moveSpeed, 6);
  });

  it('第1世代は手を離すとグリッドに吸着する（狙った場所にぴたりと止まれる）', () => {
    const player = harness('FC');
    player.body.grounded = true;
    player.body.position[0] = 1.31;
    player.tick({ move: [1, 0] });
    // 動かしている間は吸着しない
    expect(player.body.position[0]).toBe(1.31);

    player.tick({});
    expect(player.body.position[0]).toBeCloseTo(1.25, 6); // moveSnap = 0.25
  });

  it('吸着を持たない世代は止めた位置のまま', () => {
    const player = harness('PS1');
    player.body.grounded = true;
    player.body.position[0] = 1.31;
    player.tick({});
    expect(player.body.position[0]).toBe(1.31);
  });

  it('空中では吸着しない（落下中に横へ引っ張られない）', () => {
    const player = harness('FC');
    player.body.grounded = false;
    player.body.position[0] = 1.31;
    player.tick({});
    expect(player.body.position[0]).toBe(1.31);
  });
});

describe('gameplay/player のジャンプ（GAME_PLAN §5.3 / §10.4）', () => {
  it('接地中に押せば跳ぶ（全世代共通）', () => {
    for (const id of GENERATION_IDS) {
      const player = harness(id);
      player.body.grounded = true;
      player.tick({ jump: true });
      expect(player.body.velocity[1]).toBeCloseTo(JUMP_SPEED, 6);
    }
  });

  it('高さ可変の世代は離すと上昇が切れる。固定高さの世代は伸び切る', () => {
    const variable = harness('PS1');
    variable.body.grounded = true;
    variable.tick({ jump: true });
    variable.body.grounded = false;
    variable.tick({}); // 離した
    expect(variable.body.velocity[1]).toBeCloseTo(JUMP_SPEED * VARIABLE_JUMP_CUT, 6);

    const fixed = harness('FC');
    fixed.body.grounded = true;
    fixed.tick({ jump: true });
    fixed.body.grounded = false;
    fixed.tick({});
    expect(fixed.body.velocity[1]).toBeCloseTo(JUMP_SPEED, 6);
  });

  it('壁蹴りを持つ世代だけが、壁に触れていれば空中で跳べる', () => {
    const withWall = harness('SFC');
    withWall.body.grounded = false;
    withWall.body.wallDirection = 1; // 右に壁
    withWall.tick({ jump: true });
    expect(withWall.body.velocity[1]).toBeCloseTo(JUMP_SPEED, 6);
    expect(withWall.body.velocity[0]).toBeCloseTo(-WALL_JUMP_PUSH, 6);
    expect(withWall.state.facing).toBe(-1); // 壁と反対を向く

    const noWall = harness('FC');
    noWall.body.grounded = false;
    noWall.body.wallDirection = 1;
    noWall.tick({ jump: true });
    expect(noWall.body.velocity[1]).toBe(0);
  });

  it('壁蹴りは 1 回の押下で 1 回だけ', () => {
    const player = harness('PS1');
    player.body.grounded = false;
    player.body.wallDirection = -1;
    player.tick({ jump: true });
    const first = player.body.velocity[1];
    player.body.velocity[1] = 0;
    player.tick({ jump: true }); // 押しっぱなし（pressed は立たない）
    expect(first).toBeCloseTo(JUMP_SPEED, 6);
    expect(player.body.velocity[1]).toBe(0);
  });

  it('入力バッファとコヨーテタイムは全世代で効く（GAME_PLAN §10.4）', () => {
    for (const id of GENERATION_IDS) {
      // 着地の手前で押しておくと、着地した瞬間に跳ぶ
      const buffered = harness(id);
      buffered.body.grounded = false;
      buffered.tick({ jump: true });
      for (let frame = 1; frame < BUFFER_FRAMES - 1; frame++) buffered.tick({});
      expect(buffered.body.velocity[1]).toBe(0);
      buffered.body.grounded = true;
      buffered.tick({});
      expect(buffered.body.velocity[1]).toBeCloseTo(JUMP_SPEED, 6);

      // 地面を離れた直後なら跳べる
      const coyote = harness(id);
      coyote.body.grounded = true;
      coyote.tick({});
      coyote.body.grounded = false;
      coyote.tick({});
      coyote.tick({ jump: true });
      expect(coyote.body.velocity[1]).toBeCloseTo(JUMP_SPEED, 6);
    }
  });
});

describe('gameplay/player の攻撃（GAME_PLAN §5.3）', () => {
  it('正面のみの世代は、入力を上へ倒しても正面を狙う', () => {
    const player = harness('FC');
    player.tick({ move: [-1, 0] }); // 左を向く
    player.tick({ move: [0, -1], action: true });
    expect(player.state.aim).toEqual([-1, 0]);
    expect(player.state.attackTicks).toBe(ATTACK_TICKS);
  });

  it('全方位の世代は入力した向きを狙える', () => {
    const player = harness('PS1');
    player.tick({ move: [0, -1], action: true });
    expect(player.state.aim[0]).toBeCloseTo(0, 6);
    expect(player.state.aim[1]).toBeCloseTo(-1, 6);
  });

  it('溜めを持つ世代は、離した瞬間に溜め量に応じた攻撃が出る', () => {
    const player = harness('SFC');
    // 押した最初のティックの heldMs は 0 なので、溜め切るには 1 ティック余分に要る
    const holdTicks = Math.ceil(CHARGE_FULL_MS / TICK_MS) + 1;
    for (let i = 0; i < holdTicks; i++) player.tick({ action: true });
    // 押している間は出ない
    expect(player.state.attackTicks).toBe(0);

    player.tick({});
    expect(player.state.attackTicks).toBe(ATTACK_TICKS);
    expect(player.state.attackPower).toBeCloseTo(1, 2);

    // 溜めずに離せば弱い
    const quick = harness('SFC');
    quick.tick({ action: true });
    quick.tick({});
    expect(quick.state.attackPower).toBeLessThan(0.2);
  });

  it('溜めを持たない世代は押した瞬間に出る', () => {
    const player = harness('PS1');
    player.tick({ action: true });
    expect(player.state.attackTicks).toBe(ATTACK_TICKS);
    expect(player.state.chargeMs).toBe(0);
  });

  it('感圧を持つ世代だけ、押し込み量が攻撃の強さになる', () => {
    const ps2 = harness('PS2');
    ps2.tick({ action: true, pressureAnalog: 0.8 });
    expect(ps2.state.attackPower).toBeCloseTo(0.8, 6);

    const ps1 = harness('PS1');
    ps1.tick({ action: true, pressureAnalog: 0.8 });
    expect(ps1.state.attackPower).toBe(0);
  });

  it('ロックオンを持つ世代は、射程内の相手を向く', () => {
    const player = harness('PS2');
    const target = player.world.create();
    player.world.add(target, LockTarget, { position: [0, 0, -3] });
    player.tick({ move: [1, 0], action: true }); // 別の向きへ入力していても相手を向く
    expect(player.state.lockOn).toBe(target);
    expect(player.state.aim[1]).toBeCloseTo(-1, 6);

    // 射程外なら通常の全方位に戻る。第4世代の入力はカメラ相対なので、奥へ倒すと +X
    player.world.get(target, LockTarget)!.position[2] = -(LOCK_ON_RANGE + 1);
    player.tick({ move: [0, -1] });
    expect(player.state.lockOn).toBeNull();
    expect(player.state.aim).toEqual([1, 0]);
  });

  it('ロックオンを持たない世代は相手が居ても向きが変わらない', () => {
    const player = harness('PS1');
    const target = player.world.create();
    player.world.add(target, LockTarget, { position: [0, 0, -3] });
    player.tick({ move: [1, 0], action: true });
    expect(player.state.lockOn).toBeNull();
    expect(player.state.aim).toEqual([1, 0]);
  });

  it('クールダウン中は次の攻撃が出ない', () => {
    const player = harness('PS1');
    player.tick({ action: true });
    player.tick({});
    player.tick({ action: true }); // 連打
    expect(player.state.attackCooldown).toBeGreaterThan(0);
    expect(player.state.attackTicks).toBe(ATTACK_TICKS - 2);

    for (let i = 0; i < ATTACK_COOLDOWN_TICKS; i++) player.tick({});
    player.tick({ action: true });
    expect(player.state.attackTicks).toBe(ATTACK_TICKS);
  });

  it('攻撃判定は出ている間だけ存在し、溜めるほど間合いが伸びる', () => {
    const player = harness('PS1');
    expect(attackBox(player.body, player.state)).toBeNull();
    player.tick({ action: true });
    const box = attackBox(player.body, player.state)!;
    expect(box.max[0] - box.min[0]).toBeCloseTo(ATTACK_REACH, 6);

    const charged = harness('SFC');
    for (let i = 0; i < Math.ceil(CHARGE_FULL_MS / TICK_MS); i++) charged.tick({ action: true });
    charged.tick({});
    const chargedBox = attackBox(charged.body, charged.state)!;
    expect(chargedBox.max[0] - chargedBox.min[0]).toBeGreaterThan(ATTACK_REACH);
  });

  it('2D の世代では、奥行きの違う 2 つの的に同時に当たる（GAME_PLAN §5.2 の重ね合わせ）', () => {
    const player = harness('FC');
    player.tick({ move: [1, 0], action: true });
    const box = attackBox(player.body, player.state)!;

    // 正面 1.2m、奥行きだけが 4m 違う 2 つの的
    const near = aabbFromCenter([1.2, 0, 0], [0.3, 0.3, 0.3]);
    const far = aabbFromCenter([1.2, 0, -4], [0.3, 0.3, 0.3]);
    expect(overlaps(box, near, 'ortho2d')).toBe(true);
    expect(overlaps(box, far, 'ortho2d')).toBe(true);
    // 3D 投影なら手前だけ
    expect(overlaps(box, far, 'perspective3d')).toBe(false);
  });
});

describe('gameplay/player のシステム接続（§4.4 の段階 4）', () => {
  it('世代を切り替えると、同じ入力でも挙動が変わる', () => {
    const world = createWorld();
    const entity = world.create();
    const body: PlayerBodyData = world.add(entity, PlayerBody);
    const state: PlayerStateData = world.add(entity, PlayerState);
    const actions = createConsoleChaosActionMap();

    let generation: GenerationId = 'PS1';
    const system = playerSystem(() => {
      const profile = GENERATION_VIEWS[generation];
      return {
        profile,
        snapshot: sampleActions(actions, generation, { move: [0.5, 0.5] }, TICK_MS),
      };
    });

    system(world, 0);
    // 第3世代：斜めにアナログで動ける
    expect(body.velocity[0]).toBeGreaterThan(0);
    expect(body.velocity[2]).toBeGreaterThan(0);

    generation = 'FC';
    system(world, 1);
    // 第1世代：4 方向化され、2D なので奥行きは死ぬ
    expect(body.velocity[0]).toBeCloseTo(GENERATION_VIEWS.FC.theme.action.moveSpeed, 6);
    expect(body.velocity[2]).toBe(0);
    expect(state.facing).toBe(1);
  });
});
