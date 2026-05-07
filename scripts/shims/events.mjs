class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(listener);
    return this;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
    return this;
  }

  removeListener(event, listener) {
    return this.off(event, listener);
  }

  once(event, listener) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  emit(event, ...args) {
    const listeners = this._listeners.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }
    for (const listener of [...listeners]) {
      listener(...args);
    }
    return true;
  }
}

export { EventEmitter };
export default { EventEmitter };
