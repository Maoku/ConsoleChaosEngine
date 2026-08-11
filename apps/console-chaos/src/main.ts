/**
 * エントリポイント。ブートストラップのみを行い、ロジックを持たない（§3）。
 *
 * フェーズ 0 の現時点では、検証済みの土台（固定タイムステップ・GL ラッパー・
 * パス列・glTF ローダ・PS1 の頂点処理・量子化・CRT・世代切替）を繋いだ足場を動かしている。
 * ゲーム本体（ECS / 投影ルール / パズル）はフェーズ 1 で載せる。
 *
 * ?scene= で検証用シーンを選ぶ:
 *   mini（既定）  … レベルを遊ぶ。?level=area1（既定）/ mini / puzzle_lab
 *   switch        … 4 世代の切替。1〜4 キーで世代、Q で CRT 品質
 *   ps1           … 頂点量子化とアフィン UV
 *   fc            … カラークラッシュ
 */
import { browserHost, createLoop } from '@/core/loop';
import { TICK_SECONDS } from '@/core/time';
import { createGLContext } from '@/render/gl/index';
import { createSmokeFc } from '@/debug/smoke_fc';
import { createSmokePs1 } from '@/debug/smoke_ps1';
import { createSmokeSwitch } from '@/debug/smoke_switch';
import { bindMiniLevelKeys, createMiniLevel } from '@/debug/mini_level';
import { createSmokeCharacter } from '@/debug/smoke_character';
import { createSmokePlayer, type SmokePlayer } from '@/debug/smoke_player';
import { createPlaytestHud, type PlaytestHud } from '@/debug/playtest_hud';
import { createColliderHud, type ColliderHud } from '@/debug/collider_hud';
import { createPlaytestFlow } from '@/debug/playtest_flow';
import { createPlaytestLog, saveStoredRecords, storedRecords } from '@/debug/playtest_log';
import { loadLevel } from '@/level/loader';
import { GENERATION_IDS } from '@/generation/profiles';
import { createAudioDirector, type AudioDirector } from '@/audio/director';
import { bgmStatusText, bindBgmKeys, createBgmControl } from '@/debug/bgm_control';
import { createNoticeHud } from '@/debug/notice_hud';
import { songOf } from '@/audio/songs';
import { createCueTracker, pollCues } from '@/gameplay/audio_cues';
import { createHud, hudModelFromSession } from '@/ui/hud';
import { createDisplaySettings, DISPLAY_LABELS, type DisplayOptions } from '@/ui/settings';
import type { MiniLevel } from '@/debug/mini_level';
import type { Score } from '@/audio/score';
import type { CrtQuality } from '@/render/postfx/presets';

const QUALITIES: CrtQuality[] = ['full', 'light', 'off'];

/**
 * 表示設定の切替キー（BR-05）。T3-06 の設定画面が来るまでの暫定で、
 * 入力層（`input/source_keyboard.ts`）が使っていないキーから選んである。
 */
const DISPLAY_KEYS: Record<string, keyof DisplayOptions> = { n: 'moire', f: 'flatten' };

/**
 * 表示の大きさを、HUD の帯を除いた領域（`#stage`）に収める（T1-18）。
 * 内部解像度（`canvas.width/height`）は世代プロファイルが決めるので触らない。
 * CSS の `max-height:100%` では、fr トラックの中で百分率が解けず縮まないため、実測で決める。
 */
function fitCanvasToStage(canvas: HTMLCanvasElement): void {
  const stage = canvas.parentElement;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height, 1);
  canvas.style.width = `${Math.floor(canvas.width * scale)}px`;
  canvas.style.height = `${Math.floor(canvas.height * scale)}px`;
}

/**
 * 音（T1-16）の起動。ブラウザは**ユーザ操作の前に音を鳴らすことを許さない**ので、
 * 最初のキー入力・クリックまで `AudioContext` を作らない。
 * ここが持つのは「いつ作るか」だけで、鳴らし方は `audio/director.ts` が持つ。
 */
function startAudioOnFirstGesture(
  mini: MiniLevel,
  /** 最初に鳴らす曲。あとから `B` で切り替えられる（`debug/bgm_control.ts`） */
  song: Score,
  onReady: (director: AudioDirector) => void,
): void {
  const begin = (): void => {
    window.removeEventListener('pointerdown', begin);
    window.removeEventListener('keydown', begin);
    const AudioContextCtor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return; // 音が使えない環境でもゲームは動く
    const director = createAudioDirector(new AudioContextCtor(), { song });
    director.start(mini.session.profile);
    onReady(director);
  };
  window.addEventListener('pointerdown', begin, { once: false });
  window.addEventListener('keydown', begin, { once: false });
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('screen');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('#screen キャンバスが見つからない');
  }
  // 試遊（G0-1）では画面が小さいと奥行きの手掛かりが読めない。
  // 内部解像度は世代プロファイルが決めるので、ここは出力先の大きさだけを決める
  canvas.width = 960;
  canvas.height = 720;

  const ctx = createGLContext(canvas);
  const params = new URLSearchParams(location.search);
  const scene = params.get('scene') ?? 'mini';

  // 検証用シーンは 1 つだけ生成する（世代ごとの FBO を二重に持たないため）
  const ps1 = scene === 'ps1' ? createSmokePs1(ctx) : null;
  const fc = scene === 'fc' ? createSmokeFc(ctx) : null;
  const swap = scene === 'switch' ? createSmokeSwitch(ctx) : null;
  // レベルは検証済みのデータから作る（T1-07。壊れていればここで例外になる）
  // ?level= で読むレベルを選ぶ（既定はエリア 1）。T1-15
  const levelId = params.get('level') ?? 'area1';
  // アセットは配置先の相対で引く（試遊はビルド成果物を配って行うので、
  // サイトの直下に置けるとは限らない。base は vite.config.ts の './'）
  const assets = import.meta.env.BASE_URL;
  // 表示設定（BR-05）。再読み込みしても保たれるよう localStorage から読む。
  // 画面はまだ無いので操作はキー（N / F）で、切替は毎フレーム CRT パスへ届く
  const display = createDisplaySettings();
  const mini =
    scene === 'mini'
      ? await createMiniLevel(ctx, await loadLevel(`${assets}assets/levels/${levelId}.json`), assets, {
          crtOverride: () => display.crtOverride(),
        })
      : null;
  const character = scene === 'character' ? createSmokeCharacter(ctx) : null;
  // 実アセット（Blender 出力）の表示確認
  const player: SmokePlayer | null =
    scene === 'player' ? await createSmokePlayer(ctx, `${assets}assets/models/player.gltf`) : null;
  // 試遊用。操作方法だけを出し、ルールの説明は一切しない
  const playtestHud: PlaytestHud | null = mini ? createPlaytestHud() : null;
  // 当たり判定表示（C）の読み上げ。表示が切れている間は何も出ない
  const colliderHud: ColliderHud | null = mini ? createColliderHud() : null;

  // 本番の HUD（T1-18）。CRT フレームの外側に置く
  fitCanvasToStage(canvas);
  const hud = mini ? createHud(canvas) : null;
  window.addEventListener('resize', () => {
    fitCanvasToStage(canvas);
    hud?.layout();
  });
  // プレイテストの記録（T1-20）。P キーで JSON を保存する
  const playtestLog = mini ? createPlaytestLog(mini.session, levelId) : null;
  // R（やり直し）はレベルを最初から始める。途中までの記録は退避し、別の試遊として数え直す
  if (mini) {
    bindMiniLevelKeys(mini, () => {
      playtestLog?.keep();
      playtestLog?.reset();
    });
  }

  // 音（T1-16）。ユーザ操作のあとに始まり、世代が変わると音源と編曲が差し替わる
  let audio: AudioDirector | null = null;
  const cues = createCueTracker();
  // 選曲は ?bgm= で選べる（未知の値は既定の曲）。実行中は B / M で切り替える
  const initialSong = songOf(params.get('bgm'));
  // 押した直後だけ出る一時表示。曲名と表示設定で 1 つを共有する（画面の隅を奪い合わせない）
  const notice = mini ? createNoticeHud() : null;
  const bgm = mini
    ? createBgmControl({
        audio: () => audio,
        songId: initialSong.id,
        onChange: (status) => notice?.show(bgmStatusText(status)),
      })
    : null;
  if (mini && bgm) {
    startAudioOnFirstGesture(mini, initialSong.score, (director) => {
      audio = director;
      // 音が現れるまでに B / M が押されていることがある。ここで追いつかせる
      bgm.sync();
    });
    bindBgmKeys(bgm);
    window.addEventListener('keydown', (e) => {
      // ヒントの要求（T1-17）。H でその場のパズルのヒントを 1 段階引き出す
      if (e.key.toLowerCase() === 'h') mini.session.requestHint();
      // プレイテストの記録を保存する（T1-20）
      if (e.key.toLowerCase() === 'p') playtestLog?.save();
      // 表示設定の切替（BR-05）。次のフレームから CRT パスに届く
      const setting = DISPLAY_KEYS[e.key.toLowerCase()];
      if (setting) {
        const on = display.toggle(setting);
        notice?.show(`${DISPLAY_LABELS[setting]}：${on ? '入' : '切'}`);
      }
      // 進行役が時間切れで終える
      if (e.key === 'Escape') flow?.finish();
    });
  }

  /**
   * 試遊の進行（T1-20）。開発中に邪魔なら `?playtest=0` で切る。
   * 開始画面を挟むことで、音の開始に必要なユーザ操作も同時に満たす。
   */
  const flow =
    mini && playtestLog && params.get('playtest') !== '0'
      ? createPlaytestFlow({
          log: playtestLog,
          tester: params.get('tester') ?? undefined,
          isCleared: () => mini.state.cleared,
          onStart: () => playtestLog.reset(),
          onRestart: () => {
            mini.reset();
            playtestLog.reset();
          },
        })
      : null;

  if (player) {
    // デバッグ用のキー操作。1〜4 で世代、A でアニメーション切替
    window.addEventListener('keydown', (e) => {
      const index = ['1', '2', '3', '4'].indexOf(e.key);
      if (index >= 0) player.params.generation = GENERATION_IDS[index]!;
      if (e.key.toLowerCase() === 'a') player.cycleClip();
    });
  }

  if (swap) {
    // デバッグ用のキー操作。正式な入力層は T1-04
    window.addEventListener('keydown', (e) => {
      const index = ['1', '2', '3', '4'].indexOf(e.key);
      if (index >= 0) swap.switchTo(GENERATION_IDS[index]!);
      if (e.key === 'q') {
        const next = (QUALITIES.indexOf(swap.params.crtQuality) + 1) % QUALITIES.length;
        swap.params.crtQuality = QUALITIES[next]!;
      }
    });
  }

  const loop = createLoop(
    {
      tick: () => {
        if (ps1) ps1.params.cameraTime += TICK_SECONDS;
        if (fc) fc.params.sceneTime += TICK_SECONDS;
        swap?.advance(TICK_SECONDS);
        // 開始画面・終了画面が出ている間は世界を止める（記録の時間に含めない）
        const playable = flow === null || (flow.started && !flow.finished);
        if (playable) mini?.tick();
        player?.advance(TICK_SECONDS);
        flow?.update();
        if (playable) playtestLog?.update();
        if (mini && audio) {
          // 世代が変われば音源と編曲が変わる（小節位置は保たれる）
          audio.applyProfile(mini.session.profile);
          for (const cue of pollCues(cues, mini.session)) audio.playSfx(cue, mini.session.profile);
          audio.update();
        }
      },
      render: () => {
        ps1?.draw(canvas.width, canvas.height);
        fc?.draw(canvas.width, canvas.height);
        swap?.draw(canvas.width, canvas.height);
        mini?.draw(canvas.width, canvas.height);
        if (mini && hud) hud.update(hudModelFromSession(mini.session));
        if (mini && colliderHud) colliderHud.update(mini.session, mini.colliderBoxes);
        character?.draw(canvas.width, canvas.height);
        player?.draw(canvas.width, canvas.height);
      },
    },
    browserHost(),
  );
  loop.start();

  if (import.meta.env.DEV) {
    // 開発ビルドのみ。ヘッドレス検証やデバッグから 1 フレームを手動で進めるための入口。
    // 本番ビルドでは丸ごと除去される。
    (globalThis as Record<string, unknown>)['__chaos'] = {
      loop,
      ctx,
      canvas,
      ps1,
      fc,
      swap,
      mini,
      hud,
      playtestHud,
      colliderHud,
      playtestLog,
      flow,
      character,
      player,
      audio: () => audio,
      bgm,
    };
  }

  if (mini) {
    // 保存し忘れの回収用。開発ビルドかどうかに関係なく必要（試遊は配布したビルドで行う）
    (globalThis as Record<string, unknown>)['__playtest'] = {
      records: storedRecords,
      saveAll: saveStoredRecords,
    };
  }
}

void bootstrap();
