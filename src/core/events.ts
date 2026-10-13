type Handler<T> = (payload: T) => void;

/**
 * Tiny typed pub/sub. Playback commands and UI layers share this shape.
 * `on` returns an unsubscribe function.
 */
export class EventBus<Events extends object> {
  private handlers = new Map<keyof Events, Set<Handler<never>>>();

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    const existing = this.handlers.get(type);
    const set = existing ?? new Set<Handler<never>>();
    if (!existing) this.handlers.set(type, set);
    const wrapped = handler as Handler<never>;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload as never);
      } catch (error) {
        console.error(`[tide] listener for ${String(type)} failed`, error);
      }
    }
  }
}
