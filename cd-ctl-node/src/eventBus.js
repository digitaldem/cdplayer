const { EventEmitter } = require('events');

class EventBus extends EventEmitter {
  constructor() {
    super();
    // Singleton
    if (EventBus.instance) {
      return EventBus.instance;
    }

    EventBus.instance = this;
  }

  static getInstance() {
    if (!EventBus.instance) {
      new EventBus();
    }
    return EventBus.instance;
  }
}

module.exports = EventBus.getInstance();
