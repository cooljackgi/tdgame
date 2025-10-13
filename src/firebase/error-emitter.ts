// Implements a simple event emitter for cross-component communication, used for global error handling.

type EventMap = {
  'permission-error': (error: Error) => void;
  [key: string]: (...args: any[]) => void;
};

class EventEmitter {
  private events: Partial<Record<keyof EventMap, Array<(...args: any[]) => void>>> = {};

  on<K extends keyof EventMap>(event: K, listener: EventMap[K]): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event]!.push(listener);
  }

  off<K extends keyof EventMap>(event: K, listener: EventMap[K]): void {
    if (!this.events[event]) {
      return;
    }
    this.events[event] = this.events[event]!.filter(l => l !== listener);
  }

  emit<K extends keyof EventMap>(event: K, ...args: Parameters<EventMap[K]>): void {
    if (!this.events[event]) {
      return;
    }
    this.events[event]!.forEach(listener => listener(...args));
  }
}

export const errorEmitter = new EventEmitter();
