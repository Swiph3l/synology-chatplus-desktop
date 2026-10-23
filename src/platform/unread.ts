/** Use visible page state or documented read metadata, never private server APIs. */
export interface UnreadSource {
  subscribe(listener: (count: number | null) => void): () => void;
}
export const unreadSource: UnreadSource = {
  subscribe(listener) {
    listener(null);
    return () => {};
  },
};
