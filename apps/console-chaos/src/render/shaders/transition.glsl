/**
 * 世代切替のトランジション（T0-12、GAME_PLAN §5.1 / §5.4）。
 *
 * 旧世代と新世代の**両方を描画してノイズ付きでブレンドする**（§5.4.2）。
 * 描画コストは一時的に約 2 倍になるが、0.35 秒（強制切替は 0.6 秒）の間だけ。
 *
 * 演出の意味：チャンネルが切り替わる瞬間の映像の乱れ。
 * ここでプレイヤーに「世界そのものは変わっていない」と伝えたいので、
 * 位置や形が飛ばないよう、乱れは横方向のずれと明滅に留める。
 */

uniform sampler2D uPrevious;   // 旧世代の出力
uniform float uBlend;          // 0 = 旧世代のみ、1 = 新世代のみ
uniform float uGlitch;         // 乱れの強さ（0..1）
// 光の帯の色（KV-08）。基準画の実測値を `key_palette.ts` から受け取る。
// **シェーダに 16 進数を書かない**（色の出どころを 1 つに保つ。KV-01）
uniform vec3 uRibbonCore;      // 帯の芯（白）
uniform vec3 uRibbonLead;      // 先行する側（桃）
uniform vec3 uRibbonTrail;     // 後ろへ抜ける側（青）

/**
 * 光の帯の幅（掃いていく向きに測った比）。
 * 画面を横切りきるのに掛ける時間は `uBlend` そのもの＝切替の尺と同じで、
 * **切替に掛かる時間は 1 ミリ秒も変えない**（KV-08 の受け入れ条件）。
 */
const float RIBBON_HALF_WIDTH = 0.22;

/**
 * 帯の芯でも世界を完全には覆わない上限。
 * この演出が伝えたいのは「世界そのものは変わっていない」ことなので、
 * 一瞬でも画面が真っ白になると、そこで世界が切れて見える。
 */
const float RIBBON_MAX = 0.82;

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

/**
 * 四つの世界を貫く光の帯（基準画 D、計画 §3 の決定 5）。
 *
 * 基準画で帯が意味しているのは「四つの世界を行き来できること」なので、
 * 世界に置かれた物体ではなく**切替の瞬間に画面を横切るもの**として出す。
 * 物体にすると形が増え、当たり判定と不変条件 I1 の話になる。
 *
 * 斜めに傾けてあるのは基準画の構図に合わせたもので、
 * 帯は画面の外から入って画面の外へ抜ける（端で切れて見えない）。
 */
vec3 ribbon(vec3 color, float amount) {
  if (amount <= 0.0) return color;
  // 斜めの掃き。x を主、y を従にすることで基準画と同じ向きに倒れる
  float along = vUv.x * 0.8 + (1.0 - vUv.y) * 0.2;
  float center = uBlend * (1.0 + 2.0 * RIBBON_HALF_WIDTH) - RIBBON_HALF_WIDTH;
  float offset = (along - center) / RIBBON_HALF_WIDTH;
  if (abs(offset) >= 1.0) return color;

  float band = 1.0 - abs(offset);
  // 先行する側が桃、抜けていく側が青。芯へ近づくほど白い
  vec3 tint = mix(uRibbonTrail, uRibbonLead, step(0.0, offset));
  vec3 light = mix(tint, uRibbonCore, band * band * band);
  return mix(color, light, band * amount * RIBBON_MAX);
}

void main() {
  // 走査線ごとに横へずらす。切替の中間ほど強く乱れる
  float intensity = uGlitch * (1.0 - abs(uBlend * 2.0 - 1.0));
  float row = floor(vUv.y * uOutputSize.y * 0.5);
  float shift = (noise(vec2(row, floor(uTimeSeconds * 60.0))) - 0.5) * 0.06 * intensity;

  vec2 uv = vec2(clamp(vUv.x + shift, 0.0, 1.0), vUv.y);
  vec3 next = texture(uSource, uv).rgb;
  vec3 prev = texture(uPrevious, uv).rgb;

  vec3 color = mix(prev, next, clamp(uBlend, 0.0, 1.0));

  // 明滅（同期が外れた映像のちらつき）
  float flicker = 1.0 + (noise(vec2(floor(uTimeSeconds * 60.0), row)) - 0.5) * 0.35 * intensity;
  color *= flicker;

  // 光の帯（KV-08）。**`uGlitch` が 0 のときは出ない。**
  // 光過敏への配慮で乱れを切った人には、画面を横切る強い明滅も出さない（GAME_PLAN §13）
  fragColor = vec4(ribbon(color, uGlitch), 1.0);
}
