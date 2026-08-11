/**
 * FC の走査線あたりスプライト制限（T0-16 / V5、§5.4.4、GAME_PLAN §4.1）。
 *
 * 実機は 1 本の走査線に並べられるスプライトの数が決まっており、
 * 超えた分は表示されなかった。本作はこれを「意図的な差分」として採用する：
 * **消えているスプライトは当たり判定も消える**。
 * これがパズル F-2（ちらつきの隙間）の土台になる。
 *
 * 優先順位はエンティティの登録順（実機の OAM 順を模す）。
 * プレイヤーは常に最優先で登録するため、プレイヤーが消えることはない。
 *
 * 判定結果は次ティックの衝突判定で参照される（§4.4 の 1 ティック遅延）。
 */
import type { Entity } from '../core/world';

export interface SpriteDrawItem {
  entity: Entity;
  /** 画面上端からの Y（画素）。整数でなくてよい */
  y: number;
  /** スプライトの高さ（画素） */
  height: number;
}

export interface ScanlineLimitResult<T extends SpriteDrawItem> {
  visible: T[];
  /** 破棄されたエンティティ。次ティックで当たり判定を無効化する */
  culled: Entity[];
}

/**
 * 走査線ごとにスプライトを数え、上限を超えた分を破棄する。
 *
 * @param sprites 登録順（先に登録されたものが優先される）
 * @param limitPerScanline profile.video.spritesPerScanline。0 は「制限なし」
 * @param screenHeight 内部解像度の高さ。走査線カウンタの長さ
 */
export function applyScanlineLimit<T extends SpriteDrawItem>(
  sprites: readonly T[],
  limitPerScanline: number,
  screenHeight: number,
  counters: Int32Array = new Int32Array(screenHeight),
): ScanlineLimitResult<T> {
  if (limitPerScanline <= 0) {
    return { visible: [...sprites], culled: [] };
  }

  counters.fill(0, 0, screenHeight);
  const visible: T[] = [];
  const culled: Entity[] = [];

  for (const sprite of sprites) {
    const top = Math.max(Math.floor(sprite.y), 0);
    const bottom = Math.min(Math.ceil(sprite.y + sprite.height), screenHeight);
    if (bottom <= top) {
      // 画面外のスプライトは制限の対象にならない（実機も走査線に載らない）
      visible.push(sprite);
      continue;
    }

    // 覆う走査線のいずれかが既に上限に達していれば、このスプライトは表示されない
    let blocked = false;
    for (let line = top; line < bottom; line++) {
      if ((counters[line] ?? 0) >= limitPerScanline) {
        blocked = true;
        break;
      }
    }

    if (blocked) {
      culled.push(sprite.entity);
      continue;
    }
    for (let line = top; line < bottom; line++) {
      counters[line] = (counters[line] ?? 0) + 1;
    }
    visible.push(sprite);
  }

  return { visible, culled };
}

/**
 * 破棄されたスプライトを次ティックで無効化するための状態。
 *
 * 走査線制限は描画時にしか決まらないため、当たり判定への反映は 1 ティック遅れる
 *（§4.4 の注記。60fps で 16.6ms であり体感できないと判断した）。
 */
export interface FlickerState {
  /** 現在のティックで当たり判定を無効化すべきエンティティ */
  culled: ReadonlySet<Entity>;
}

export function createFlickerState(): { state: FlickerState; commit(culled: readonly Entity[]): void } {
  let current = new Set<Entity>();
  const state: FlickerState = {
    get culled() {
      return current;
    },
  };
  return {
    state,
    /** 描画で得た破棄結果を、次ティック用に書き戻す */
    commit(culled): void {
      current = new Set(culled);
    },
  };
}
