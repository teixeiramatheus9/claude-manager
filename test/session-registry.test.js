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

describe('reconciling against the live Claude Code sessions', () => {
  const S1 = '4b706711-9840-4931-8b0f-d6d51518d6ba';
  const S2 = '7d6b682c-5c11-4e0a-b3d2-9f0e1a7c4d55';
  const withSessions = (...ids) => {
    const registry = new SessionRegistry();
    for (const id of ids) registry.applyEvent(promptEvent({ session_id: id }));
    return registry;
  };

  it('drops a session whose terminal was closed', () => {
    const registry = withSessions(S1, S2);
    registry.reconcileLiveSessions(new Set([S1, S2]));

    registry.reconcileLiveSessions(new Set([S1]));

    expect([...registry.sessions.keys()]).toEqual([S1]);
  });

  // A session the manager never saw in the registry may be running on a build
  // without it, so its absence proves nothing and it must survive.
  it('keeps a session it never saw alive in the registry', () => {
    const registry = withSessions(S1);

    registry.reconcileLiveSessions(new Set());

    expect([...registry.sessions.keys()]).toEqual([S1]);
  });

  it('ignores a null reading, which means the registry is unreadable', () => {
    const registry = withSessions(S1);
    registry.reconcileLiveSessions(new Set([S1]));

    registry.reconcileLiveSessions(null);

    expect([...registry.sessions.keys()]).toEqual([S1]);
  });

  it('announces the change only when a session actually went away', () => {
    const registry = withSessions(S1);
    registry.reconcileLiveSessions(new Set([S1]));
    const onChange = vi.fn();
    registry.on('change', onChange);

    registry.reconcileLiveSessions(new Set([S1]));
    expect(onChange).not.toHaveBeenCalled();

    registry.reconcileLiveSessions(new Set());
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // Sessions persisted before this app knew about liveness carry no flag, so
  // they would otherwise sit there until the 12h prune. A registry listing a
  // live session proves it works on this machine, which makes absence mean
  // something on its own.
  it('reaps an unflagged session once the registry proves it is working', () => {
    const registry = new SessionRegistry();
    registry.hydrate([{ id: '6b2aa174-1f3e-4a5c-9d80-2b1c4e7f9a03', updatedAt: 1 }]);

    registry.reconcileLiveSessions(new Set(['4b706711-9840-4931-8b0f-d6d51518d6ba']));

    expect([...registry.sessions.keys()]).toEqual([]);
  });

  // simulate-event.sh fabricates sessions with no process behind them; the
  // registry can never list one, so its absence proves nothing.
  it('keeps a simulated session the registry could never list', () => {
    const registry = withSessions('sim-projeto-teste');

    registry.reconcileLiveSessions(new Set(['4b706711-9840-4931-8b0f-d6d51518d6ba']));

    expect([...registry.sessions.keys()]).toEqual(['sim-projeto-teste']);
  });

  // Liveness survives a restart through sessions.json, so a session closed
  // while the app was down is reaped on the first reading after it comes back.
  it('reaps a hydrated session that was seen alive before the restart', () => {
    const registry = new SessionRegistry();
    registry.hydrate([{ id: S1, seenAlive: true, updatedAt: 1 }]);

    registry.reconcileLiveSessions(new Set());

    expect([...registry.sessions.keys()]).toEqual([]);
  });
});

describe('remove', () => {
  it('drops the session and reports the change', () => {
    const registry = new SessionRegistry();
    registry.applyEvent({ hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/a' });
    registry.applyEvent({ hook_event_name: 'Stop', session_id: 's2', cwd: '/tmp/b' });
    let changes = 0;
    registry.on('change', () => (changes += 1));

    registry.remove('s1');
    expect(registry.list().map((session) => session.id)).toEqual(['s2']);
    expect(changes).toBe(1);
  });

  it('stays quiet for an id that is not there', () => {
    const registry = new SessionRegistry();
    let changes = 0;
    registry.on('change', () => (changes += 1));
    registry.remove('nope');
    expect(changes).toBe(0);
  });

  it('lets a new event bring the chat back', () => {
    const registry = new SessionRegistry();
    registry.applyEvent({ hook_event_name: 'Stop', session_id: 's1', cwd: '/tmp/a' });
    registry.remove('s1');
    registry.applyEvent({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: '/tmp/a' });
    expect(registry.list()).toHaveLength(1);
    expect(registry.sessions.get('s1').status).toBe('working');
  });
});
