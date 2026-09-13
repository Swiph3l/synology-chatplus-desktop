/** Future unread adapters must use visible page state, never private server APIs. */
export interface UnreadSource {
  subscribe(listener: (count: number | null) => void): () => void;
}
export const unreadSource: UnreadSource = {
  subscribe(listener) {
    listener(null);
    return () => {};
  },
};
