/**
 * Console Chaos 専用の ESLint ルール群（IMPLEMENTATION_PLAN §7.3）。
 *
 * - no-generation-branch : `profiles.ts` / `pipeline.ts` 以外での世代 ID 直接分岐を禁止（不変条件 I2）
 * - no-raw-aabb-compare  : `projection.overlaps` を経由しない AABB 比較を禁止（§5.6）
 */

const GENERATION_IDS = new Set(['FC', 'SFC', 'PS1', 'PS2']);

/** 世代 ID の文字列リテラルか */
function isGenerationLiteral(node) {
  return node?.type === 'Literal' && typeof node.value === 'string' && GENERATION_IDS.has(node.value);
}

const noGenerationBranch = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'ゲームロジックに世代 ID の分岐を書かない。参照してよいのは GenerationProfile の値のみ（不変条件 I2）',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      branch:
        "世代 ID '{{id}}' による分岐は generation/profiles.ts と render/pipeline.ts でのみ許される（不変条件 I2）。GenerationProfile の値を参照すること。",
    },
  },
  create(context) {
    const allow = context.options[0]?.allow ?? [];
    const filename = context.filename ?? context.getFilename();
    const normalized = filename.replaceAll('\\', '/');
    if (allow.some((suffix) => normalized.endsWith(suffix))) return {};

    /** 比較演算子の左右に世代 ID リテラルが出てきたら分岐とみなす */
    function checkComparison(node) {
      if (!['==', '===', '!=', '!=='].includes(node.operator)) return;
      for (const side of [node.left, node.right]) {
        if (isGenerationLiteral(side)) {
          context.report({ node: side, messageId: 'branch', data: { id: side.value } });
        }
      }
    }

    return {
      BinaryExpression: checkComparison,
      SwitchCase(node) {
        if (isGenerationLiteral(node.test)) {
          context.report({ node: node.test, messageId: 'branch', data: { id: node.test.value } });
        }
      },
    };
  },
};

const noRawAabbCompare = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'AABB の重なり判定は projection.overlaps を経由する。min/max を直接比較しない（§5.6）',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allow: { type: 'array', items: { type: 'string' } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawCompare:
        'AABB の min/max を直接比較している。重なり判定は projection.ts の overlaps() を経由すること（§5.6）。',
    },
  },
  create(context) {
    const allow = context.options[0]?.allow ?? [];
    const filename = context.filename ?? context.getFilename();
    const normalized = filename.replaceAll('\\', '/');
    if (allow.some((suffix) => normalized.endsWith(suffix))) return {};

    /** `x.min[0]` や `x.max.y` のように AABB の境界へアクセスしているか */
    function isAabbBound(node) {
      let cur = node;
      // 添字/プロパティアクセスを 1 段だけ剥がす（min[0] → min）
      if (cur?.type === 'MemberExpression') {
        const prop = cur.property;
        const isIndexLike =
          (cur.computed && prop.type === 'Literal' && typeof prop.value === 'number') ||
          (!cur.computed && prop.type === 'Identifier' && ['x', 'y', 'z'].includes(prop.name));
        if (isIndexLike) cur = cur.object;
      }
      return (
        cur?.type === 'MemberExpression' &&
        !cur.computed &&
        cur.property.type === 'Identifier' &&
        (cur.property.name === 'min' || cur.property.name === 'max')
      );
    }

    return {
      BinaryExpression(node) {
        if (!['<', '<=', '>', '>='].includes(node.operator)) return;
        if (isAabbBound(node.left) && isAabbBound(node.right)) {
          context.report({ node, messageId: 'rawCompare' });
        }
      },
    };
  },
};

export default {
  rules: {
    'no-generation-branch': noGenerationBranch,
    'no-raw-aabb-compare': noRawAabbCompare,
  },
};
