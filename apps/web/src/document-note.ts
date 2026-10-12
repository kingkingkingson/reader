import { useEffect, useState } from "react";
import { api } from "@reader/api";
import { toast } from "sonner";

export type DocumentNoteStatus = "loading" | "idle" | "saving" | "saved";

type NoteState = {
  body: string;
  saved: string;
  loaded: boolean;
  edited: boolean;
  status: DocumentNoteStatus;
  fetching: boolean;
  timer?: ReturnType<typeof setTimeout>;
  writing?: string;
  listeners: Set<() => void>;
};

const notes = new Map<string, NoteState>();

function noteState(id: string) {
  let state = notes.get(id);
  if (!state) {
    state = {
      body: "",
      saved: "",
      loaded: false,
      edited: false,
      fetching: false,
      status: "loading",
      listeners: new Set(),
    };
    notes.set(id, state);
  }
  return state;
}

function emit(state: NoteState) {
  for (const listener of state.listeners) listener();
}

async function persist(id: string) {
  const state = notes.get(id);
  if (!state || state.body === state.saved || state.writing === state.body)
    return;
  const text = state.body;
  state.writing = text;
  state.status = "saving";
  emit(state);
  try {
    await api.saveDocumentNote(id, text);
    if (notes.get(id) !== state) return;
    state.saved = text;
    if (state.body === text) state.status = "saved";
  } catch (e) {
    if (notes.get(id) !== state) return;
    state.status = "idle";
    toast.error((e as Error).message);
  } finally {
    if (notes.get(id) === state && state.writing === text)
      state.writing = undefined;
  }
  if (notes.get(id) !== state) return;
  emit(state);
  if (state.body !== state.saved) schedule(id);
}

function schedule(id: string) {
  const state = notes.get(id);
  if (!state) return;
  clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = undefined;
    void persist(id);
  }, 800);
}

function flush(id: string) {
  const state = notes.get(id);
  if (!state) return;
  clearTimeout(state.timer);
  state.timer = undefined;
  void persist(id);
}

/** Drops cached notes. Tests use this so one document id does not leak into the next case. */
export function clearDocumentNotes() {
  for (const state of notes.values()) clearTimeout(state.timer);
  notes.clear();
}

/** The single note for a document. Open editors share one draft and one save. */
export function useDocumentNote(documentId: string) {
  const state = noteState(documentId);
  const [, refresh] = useState(0);
  useEffect(() => {
    const current = noteState(documentId);
    const listener = () => refresh((n) => n + 1);
    current.listeners.add(listener);
    if (!current.loaded && !current.fetching) {
      current.fetching = true;
      void api
        .documentNote(documentId)
        .then((note) => {
          if (notes.get(documentId) !== current || current.loaded) return;
          if (!current.edited) current.body = note.body;
          current.saved = note.body;
          current.loaded = true;
          current.status = "idle";
          emit(current);
          if (current.body !== current.saved) schedule(documentId);
        })
        .catch((e) => {
          if (notes.get(documentId) !== current) return;
          current.loaded = true;
          current.status = "idle";
          emit(current);
          toast.error((e as Error).message);
        });
    }
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size === 0) flush(documentId);
    };
  }, [documentId]);
  return {
    body: state.body,
    status: state.loaded ? state.status : "loading",
    setBody: (text: string, immediate = false) => {
      const current = noteState(documentId);
      current.edited = true;
      current.body = text;
      if (current.status === "saved") current.status = "idle";
      emit(current);
      if (immediate) flush(documentId);
      else schedule(documentId);
    },
    flush: () => flush(documentId),
  };
}

export function pastedNoteImages(data: DataTransfer | null) {
  if (!data) return [];
  const fromItems = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  if (fromItems.length) return fromItems;
  return Array.from(data.files).filter((file) =>
    file.type.startsWith("image/"),
  );
}

export function placeNoteImages(
  body: string,
  start: number,
  end: number,
  ids: string[],
) {
  const snippet = ids.map((id) => `![](note-image:${id})`).join("\n\n");
  const head = body.slice(0, start);
  const tail = body.slice(end);
  const before =
    head && !head.endsWith("\n\n") ? (head.endsWith("\n") ? "\n" : "\n\n") : "";
  const after = tail && !tail.startsWith("\n") ? "\n\n" : "";
  return {
    text: head + before + snippet + after + tail,
    caret: head.length + before.length + snippet.length,
  };
}
