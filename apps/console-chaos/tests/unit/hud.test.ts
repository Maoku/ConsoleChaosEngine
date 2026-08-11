/**
 * T1-18「HUD / チャンネルインジケータ」の検証。
 * 受け入れ条件は「CRT フレームの外側に表示され、ゲーム画面の再現性を汚さない」。
 *
 * DOM を持たない環境（Vitest は node 環境。§7.1）で回すので、
 * ここで検査するのは**表示内容を決める部分**と、
 * 「HUD がゲーム画面へ描く経路を持たない」ことの静的な確認。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  channelIndicatorModel,
  channelIndicatorText,
  WARNING_BLINK_PERIOD_MS,
  type ChannelView,
} from '@/ui/channel_indicator';
import { hintText, hudModelFromSession, progressText } from '@/ui/hud';
import { requestHint } from '@/gameplay/hints';
import { loadLevelFile } from './replay/harness';
import { createTestSession, tickSession } from './session-testkit';

function view(overrides: Partial<ChannelView> = {}): ChannelView {
  return {
    generation: 'FC',
    from: null,
    pending: null,
    forced: false,
    warningRemainingMs: null,
    warningTo: null,
    ...overrides,
  };
}

describe('ui/channel_indicator', () => {
  it('チャンネル番号と世代名を出す（実機名は出さない。§7.1.1）', () => {
    const model = channelIndicatorModel(view({ generation: 'PS2' }));
    expect(channelIndicatorText(model)).toBe('CH 4 / 第4世代');
  });

  it('切替中は行き先を併記する', () => {
    const model = channelIndicatorModel(view({ generation: 'SFC', from: 'FC' }));
    expect(model.switching).toBe(true);
    expect(channelIndicatorText(model)).toBe('CH 2 / 第2世代  →  CH 2');
  });

  it('連打で予約された行き先が読める', () => {
    const model = channelIndicatorModel(view({ generation: 'SFC', from: 'FC', pending: 'PS2' }));
    expect(channelIndicatorText(model)).toContain('→  CH 4');
  });

  it('強制切替の予告では行き先を先出しし、ゆっくり点滅する（GAME_PLAN §5.4）', () => {
    const first = channelIndicatorModel(view({ warningRemainingMs: 1500, warningTo: 'PS1' }));
    expect(first.forced).toBe(true);
    expect(channelIndicatorText(first)).toContain('CH 3');

    // 1 周期ごとに反転する（速い明滅は光過敏の配慮に反するため、周期は 0.5 秒）
    const next = channelIndicatorModel(
      view({ warningRemainingMs: 1500 - WARNING_BLINK_PERIOD_MS, warningTo: 'PS1' }),
    );
    expect(next.blinkOn).toBe(!first.blinkOn);
  });

  it('予告が出ていなければ点滅しない', () => {
    expect(channelIndicatorModel(view()).blinkOn).toBe(false);
    expect(channelIndicatorModel(view()).forced).toBe(false);
  });
});

describe('ui/hud', () => {
  const level = loadLevelFile('area1');

  it('セッションの状態から表示内容が決まる', () => {
    const session = createTestSession({ level, generation: 'FC' });
    tickSession(session, null);
    const model = hudModelFromSession(session);
    expect(model.channel.generation).toBe('FC');
    expect(model.puzzleCount).toBe(level.puzzles.length);
    expect(progressText(model)).toBe(`0 / ${level.puzzles.length}`);
    expect(model.fade).toBe(0);
  });

  it('ヒントは段階つきで出る。出ていなければ空文字', () => {
    const session = createTestSession({ level, generation: 'FC' });
    const vine = level.entities.find((entity) => entity.id === 'f1_vine_a')!;
    session.player.position = [...vine.transform.position] as [number, number, number];
    tickSession(session, null);
    expect(hintText(hudModelFromSession(session).hint)).toBe('');

    requestHint(session.hints, 'F-1');
    const text = hintText(hudModelFromSession(session).hint);
    expect(text).toContain('ヒント 1／4');
    expect(text).toContain('別の世代');
  });

  it('復帰の暗転は HUD が読む（checkpoint.fadeAmount）', () => {
    const session = createTestSession({ level, generation: 'FC', fallLimitY: 100 });
    tickSession(session, null); // 出発直後に「落ちた」ことになり、暗転が始まる
    expect(hudModelFromSession(session).fade).toBeGreaterThan(0);
  });

  it('HUD は描画パイプラインへ触れない（DOM だけで作る）', () => {
    for (const path of ['src/ui/hud.ts', 'src/ui/channel_indicator.ts']) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toContain('@/render/');
      expect(source).not.toContain('gl.');
    }
  });
});
