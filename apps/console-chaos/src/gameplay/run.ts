import type { Session } from './session';

/** 明示的に新しいプレイを始める経路は、世界と表示世代を CH 1 へ揃える。 */
export function startNewRun(session: Session): void {
  session.reset();
  session.generation.request('FC');
}
