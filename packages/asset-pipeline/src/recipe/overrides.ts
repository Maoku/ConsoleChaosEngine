import { type JsonObject, type JsonValue } from './define';

export interface RecipeOverride {
  readonly path: string;
  readonly value: JsonValue;
  readonly assignment: string;
}

export function parseOverrideValue(raw: string): JsonValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const number = Number(raw);
  if (raw.trim() !== '' && Number.isFinite(number)) return number;
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

export function parseRecipeOverride(assignment: string): RecipeOverride {
  const separator = assignment.indexOf('=');
  if (separator <= 0) throw new Error(`--set must use path=value: ${assignment}`);
  const path = assignment.slice(0, separator);
  if (path.split('.').some((part) => part.length === 0)) throw new Error(`invalid --set path: ${path}`);
  return { path, value: parseOverrideValue(assignment.slice(separator + 1)), assignment };
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite JSON number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertJsonValue(child, `${path}.${key}`);
    return;
  }
  throw new Error(`${path} is not JSON-compatible`);
}

export function validateRecipe(recipe: JsonObject): void {
  assertJsonValue(recipe, 'recipe');
}

export function applyRecipeOverrides<Recipe extends JsonObject>(
  recipe: Recipe,
  assignments: readonly string[],
): { readonly recipe: Recipe; readonly applied: readonly RecipeOverride[] } {
  validateRecipe(recipe);
  const clone = structuredClone(recipe) as Recipe;
  const applied = assignments.map(parseRecipeOverride);
  for (const override of applied) {
    const parts = override.path.split('.');
    const leaf = parts.pop();
    if (!leaf) throw new Error(`invalid --set path: ${override.path}`);
    let node: Record<string, unknown> = clone;
    for (const part of parts) {
      const next = node[part];
      if (next === null || typeof next !== 'object' || Array.isArray(next)) {
        throw new Error(`unknown recipe path: ${override.path}`);
      }
      node = next as Record<string, unknown>;
    }
    if (!Object.hasOwn(node, leaf)) throw new Error(`unknown recipe path: ${override.path}`);
    const current = node[leaf];
    if (current !== null && override.value !== null && typeof current !== typeof override.value) {
      throw new Error(`recipe override type mismatch at ${override.path}: expected ${typeof current}`);
    }
    node[leaf] = override.value;
  }
  validateRecipe(clone);
  return { recipe: clone, applied };
}
