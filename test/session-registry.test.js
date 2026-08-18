import { describe, it, expect, vi } from 'vitest';
import { SessionRegistry, STATUS } from '../src/main/session-registry.js';

const promptEvent = (overrides = {}) => ({
  hook_event_name: 'UserPromptSubmit',
  session_id: 's1',
  cwd: '/home/user/projects/projeto-alpha',
  transcript_path: '/tmp/t.jsonl',
  ...overrides,
});

describe('SessionRegistry', () => {
  it('creates a working session on UserPromptSubmit', () => {
    const registry = new SessionRegistry();
    const session = registry.applyEvent(promptEvent());
    expect(session.status).toBe(STATUS.WORKING);
    expect(session.projectName).toBe('projeto-alpha');
    expect(session.unread).toBe(false);
  });

  it('marks session done and unread on Stop', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent());
    const session = registry.applyEvent(promptEvent({ hook_event_name: 'Stop' }));
    expect(session.status).toBe(STATUS.DONE);
    expect(session.unread).toBe(true);
    expect(registry.unreadCount()).toBe(1);
  });

  it('marks session waiting with the event message on Notification', () => {
    const registry = new SessionRegistry();
    const session = registry.applyEvent(
      promptEvent({ hook_event_name: 'Notification', message: 'precisa de permissão' }),
    );
    expect(session.status).toBe(STATUS.WAITING);
    expect(session.managerMessage).toBe('precisa de permissão');
    expect(session.unread).toBe(true);
  });

  it('ignores unknown events and events without session_id', () => {
    const registry = new SessionRegistry();
    expect(registry.applyEvent({ hook_event_name: 'PreToolUse', session_id: 'x' })).toBeNull();
    expect(registry.applyEvent(promptEvent({ session_id: undefined }))).toBeNull();
    expect(registry.list()).toHaveLength(0);
  });

  it('a new prompt resets unread and clears the manager message', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent({ hook_event_name: 'Stop' }));
    registry.setManagerMessage('s1', { title: 'fix bug', message: 'terminou!' });
    const session = registry.applyEvent(promptEvent());
    expect(session.unread).toBe(false);
    expect(session.managerMessage).toBeNull();
  });

  it('setManagerMessage stores title and message and emits change', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent({ hook_event_name: 'Stop' }));
    const listener = vi.fn();
    registry.on('change', listener);
    registry.setManagerMessage('s1', { title: 'fix bug', message: 'terminou po' });
    const [session] = registry.list();
    expect(session.title).toBe('fix bug');
    expect(session.managerMessage).toBe('terminou po');
    expect(listener).toHaveBeenCalled();
  });

  it('markAllRead clears unread flags', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent({ hook_event_name: 'Stop' }));
    registry.markAllRead();
    expect(registry.unreadCount()).toBe(0);
  });

  it('prune removes sessions older than maxAgeMs', () => {
    let currentTime = 1000;
    const registry = new SessionRegistry({ maxAgeMs: 500, now: () => currentTime });
    registry.applyEvent(promptEvent());
    currentTime = 2000;
    registry.applyEvent(promptEvent({ session_id: 's2', cwd: '/tmp/other' }));
    registry.prune();
    expect(registry.list().map((session) => session.id)).toEqual(['s2']);
  });

  it('keeps the FIRST prompt as the topic preview and truncates it', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent({ prompt: 'arruma o bug do login que tá quebrando tudo no ambiente de produção urgente' }));
    const session = registry.applyEvent(promptEvent({ prompt: 'segundo prompt' }));
    expect(session.promptPreview.startsWith('arruma o bug do login')).toBe(true);
    expect(session.promptPreview.length).toBeLessThanOrEqual(61);
  });

  it('setQuestion stores the pending question and a new prompt clears it', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent({ hook_event_name: 'Notification', message: 'esperando' }));
    const question = { questions: [{ question: 'Qual?', options: ['a', 'b'] }] };
    registry.setQuestion('s1', question);
    expect(registry.list()[0].question).toEqual(question);
    registry.applyEvent(promptEvent());
    expect(registry.list()[0].question).toBeNull();
  });

  it('markAnswered clears the question and puts the session back to work', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent({ hook_event_name: 'Notification', message: 'esperando' }));
    registry.setQuestion('s1', { questions: [{ question: 'Qual?', options: ['a', 'b'] }] });
    registry.markAnswered('s1');
    const [session] = registry.list();
    expect(session.question).toBeNull();
    expect(session.status).toBe(STATUS.WORKING);
    expect(session.unread).toBe(false);
  });

  it('dismissMessage clears message, question and unread', () => {
    const registry = new SessionRegistry();
    registry.applyEvent(promptEvent({ hook_event_name: 'Notification', message: 'esperando' }));
    registry.setQuestion('s1', { questions: [{ question: 'Qual?', options: ['a'] }] });
    registry.dismissMessage('s1');
    const [session] = registry.list();
    expect(session.managerMessage).toBeNull();
    expect(session.question).toBeNull();
    expect(session.unread).toBe(false);
  });

  it('serialize/hydrate round-trips sessions without emitting change', () => {
    const source = new SessionRegistry();
    source.applyEvent(promptEvent({ hook_event_name: 'Stop' }));
    const restored = new SessionRegistry();
    const listener = vi.fn();
    restored.on('change', listener);
    restored.hydrate(source.serialize());
    expect(listener).not.toHaveBeenCalled();
    expect(restored.list()).toEqual(source.list());
    restored.hydrate([{ notAnId: true }]);
    expect(restored.list()).toHaveLength(1);
  });

  it('list sorts by updatedAt descending', () => {
    let currentTime = 1;
    const registry = new SessionRegistry({ now: () => currentTime });
    registry.applyEvent(promptEvent());
    currentTime = 2;
    registry.applyEvent(promptEvent({ session_id: 's2', cwd: '/tmp/other' }));
    expect(registry.list()[0].id).toBe('s2');
  });
});
