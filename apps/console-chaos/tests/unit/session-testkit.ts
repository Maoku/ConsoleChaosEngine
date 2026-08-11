import { createGenerationController, type GenerationId } from '@console-chaos/engine';
import { createSession, type Session, type SessionOptions } from '@/gameplay/session';
import type { RawInput } from '@/input/mapper';

export type StandaloneSessionOptions = Omit<SessionOptions, 'generation'> & {
  generation?: GenerationId;
};

export function createTestSession(options: StandaloneSessionOptions): Session {
  return createSession({
    ...options,
    generation: createGenerationController(options.generation ?? 'PS1'),
  });
}

export function tickSession(session: Session, input: RawInput | null): void {
  session.prepare(input);
  session.generation.advance(1000 / 60);
  session.tick();
}
