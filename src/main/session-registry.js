import { EventEmitter } from 'node:events';
import path from 'node:path';

export const STATUS = {
  WORKING: 'working',
  DONE: 'done',
  WAITING: 'waiting',
};

const HANDLED_EVENTS = ['UserPromptSubmit', 'Stop', 'Notification'];
const DEFAULT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export class SessionRegistry extends EventEmitter {
  constructor({ maxAgeMs = DEFAULT_MAX_AGE_MS, now = () => Date.now() } = {}) {
    super();
    this.maxAgeMs = maxAgeMs;
    this.now = now;
    this.sessions = new Map();
  }

  applyEvent(event) {
    const eventName = event?.hook_event_name;
    const sessionId = event?.session_id;
    if (!sessionId || !HANDLED_EVENTS.includes(eventName)) return null;

    const session = this.sessions.get(sessionId) ?? {
      id: sessionId,
      cwd: '',
      projectName: 'sessão',
      transcriptPath: null,
      status: STATUS.WORKING,
      title: null,
      promptPreview: null,
      question: null,
      managerMessage: null,
      unread: false,
      updatedAt: 0,
      wave: null,
    };
    if (event.wave?.blockId) session.wave = event.wave;
    if (event.cwd) {
      session.cwd = event.cwd;
      session.projectName = path.basename(event.cwd);
    }
    if (event.transcript_path) session.transcriptPath = event.transcript_path;
    session.updatedAt = this.now();

    if (eventName === 'UserPromptSubmit') {
      session.status = STATUS.WORKING;
      session.unread = false;
      session.managerMessage = null;
      session.question = null;
      if (!session.promptPreview && typeof event.prompt === 'string' && event.prompt.trim()) {
        const preview = event.prompt.trim();
        session.promptPreview = preview.length > 60 ? `${preview.slice(0, 60)}…` : preview;
      }
    } else if (eventName === 'Stop') {
      session.status = STATUS.DONE;
      session.unread = true;
    } else {
      session.status = STATUS.WAITING;
      session.unread = true;
      session.managerMessage = event.message ?? 'Esperando você dar uma olhada.';
    }

    this.sessions.set(sessionId, session);
    this.emit('change');
    return session;
  }

  setManagerMessage(sessionId, { title, message }) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (title) session.title = title;
    session.managerMessage = message;
    this.emit('change');
  }

  // The chat resumes working after a question is answered from the panel.
  markAnswered(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.question = null;
    session.managerMessage = null;
    session.status = STATUS.WORKING;
    session.unread = false;
    session.updatedAt = this.now();
    this.emit('change');
  }

  dismissMessage(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.managerMessage = null;
    session.question = null;
    session.unread = false;
    this.emit('change');
  }

  setQuestion(sessionId, question) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.question = question;
    this.emit('change');
  }

  markAllRead() {
    let changed = false;
    for (const session of this.sessions.values()) {
      if (session.unread) {
        session.unread = false;
        changed = true;
      }
    }
    if (changed) this.emit('change');
  }

  prune() {
    const cutoff = this.now() - this.maxAgeMs;
    let changed = false;
    for (const [sessionId, session] of this.sessions) {
      if (session.updatedAt < cutoff) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    }
    if (changed) this.emit('change');
  }

  serialize() {
    return [...this.sessions.values()];
  }

  // Restores persisted sessions without emitting change (startup only).
  hydrate(sessions = []) {
    for (const session of sessions) {
      if (session?.id) this.sessions.set(session.id, { ...session });
    }
  }

  unreadCount() {
    return [...this.sessions.values()].filter((session) => session.unread).length;
  }

  list() {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
