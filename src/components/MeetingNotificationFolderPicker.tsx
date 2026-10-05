import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Folder, Plus, Search, Users, X } from "./icons";
import { defaultFolderDisplayName, folderMatchesQuery } from "./notes/shared";
import type { MeetingDestinationContext, MeetingError, MeetingFolderRef } from "../types/electron";

const key = (name: string) => `meetingNotification.folders.${name}`;
import { meetingFolderLabel } from "./meetingFolderLabel";

interface Props {
  context: MeetingDestinationContext | null;
  mode: "list" | "form";
  busy: boolean;
  focusReady: boolean;
  error: MeetingError | null;
  onMode: (mode: "closed" | "list" | "form") => void;
  onSelect: (folder: MeetingFolderRef) => void;
  onCreate: (request: { requestId: string; name: string; spaceId: number }) => void;
  onRetry: () => void;
}

export function MeetingNotificationFolderPicker({
  context,
  mode,
  busy,
  focusReady,
  error,
  onMode,
  onSelect,
  onCreate,
  onRetry,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [spaceId, setSpaceId] = useState<number | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const commitKey = useRef(false);
  const createRequest = useRef<{ key: string; id: string } | null>(null);
  const priorMode = useRef(mode);
  const folders = useMemo(() => context?.folders ?? [], [context]);
  const selected = context?.selectedDestination ?? context?.defaultDestination;
  const groups = useMemo(() => {
    if (query.trim())
      return [
        {
          label: t(key("folders")),
          items: folders.filter((f) => folderMatchesQuery(f, t, query.trim())),
        },
      ];
    const recent = (context?.recentDestinations ?? []).flatMap((ref) =>
      folders.filter((f) => f.id === ref.folderId && f.space_id === ref.spaceId)
    );
    const fallback = folders
      .filter((f) => !recent.some((r) => r.id === f.id))
      .slice(0, Math.max(0, 5 - recent.length));
    const pinned = folders.filter(
      (f) =>
        f.id === selected?.folderId &&
        f.space_id === selected.spaceId &&
        !recent.some((r) => r.id === f.id) &&
        !fallback.some((r) => r.id === f.id)
    );
    return [
      { label: t(key("current")), items: pinned },
      { label: t(key("recent")), items: recent },
      { label: t(key("folders")), items: fallback },
    ].filter((g) => g.items.length);
  }, [context, folders, query, selected, t]);
  const visible = groups.flatMap((g) => g.items);
  useEffect(() => {
    setActive(0);
  }, [query]);
  useEffect(() => {
    if (mode === "form" && priorMode.current !== "form") {
      setDraft(folders.some((f) => folderMatchesQuery(f, t, query.trim())) ? "" : query.trim());
      setSpaceId(context?.spaces.find((s) => s.kind === "private")?.id ?? null);
      setLocationOpen(false);
      createRequest.current = null;
    }
    priorMode.current = mode;
    if (focusReady && !busy) (mode === "form" ? nameRef : searchRef).current?.focus();
  }, [mode, focusReady, busy, context?.spaces, folders, query, t]);
  useEffect(() => {
    document
      .getElementById(`meeting-folder-option-${active}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const ignoreComposition = (event: KeyboardEvent) => {
    if (
      composing.current ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      commitKey.current
    )
      return true;
    return false;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (ignoreComposition(event)) {
      if (
        !composing.current &&
        !event.nativeEvent.isComposing &&
        commitKey.current &&
        event.key === "Enter"
      )
        event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (locationOpen) setLocationOpen(false);
      else onMode(mode === "form" ? "list" : "closed");
    } else if (mode === "list" && !context?.existingNote && event.target === searchRef.current) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) =>
          Math.max(0, Math.min(visible.length - 1, i + (event.key === "ArrowDown" ? 1 : -1)))
        );
      } else if (event.key === "Enter" && visible[active] && !busy) {
        event.preventDefault();
        onSelect({ folderId: visible[active].id, spaceId: visible[active].space_id });
      }
    }
  };
  const submit = () => {
    if (busy || composing.current || commitKey.current || spaceId === null) return;
    const inputKey = JSON.stringify([draft.trim(), spaceId]);
    if (createRequest.current?.key !== inputKey)
      createRequest.current = { key: inputKey, id: crypto.randomUUID() };
    onCreate({ requestId: createRequest.current.id, name: draft, spaceId });
  };
  const linked = context?.existingNote;
  const linkedFolder = folders.find((f) => f.id === linked?.folderId);
  const linkedLocation = linked
    ? `${linked.shared ? linked.spaceName : t(key("private"))}${linked.folderName ? ` / ${linkedFolder ? defaultFolderDisplayName(linkedFolder, t) : linked.folderName}` : ""}${linked.shared ? ` · ${t(key("shared"))}` : ""}`
    : "";
  const errorView = error && (
    <p role="alert" className="meeting-folder-error">
      {t(key(`errors.${error}`))}
    </p>
  );
  return (
    <div
      data-meeting-region="picker"
      className="meeting-folder-picker"
      role="dialog"
      aria-label={t(key("choose"))}
      onKeyDown={onKeyDown}
      onKeyUp={() => {
        commitKey.current = false;
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        commitKey.current = true;
      }}
    >
      {linked ? (
        <div className="p-2 text-xs leading-relaxed">
          <p className="font-medium">{linkedLocation}</p>
          <p className="mt-2 text-muted-foreground">
            {t(key("linked"), { destination: linkedLocation })}
          </p>
          {errorView}
        </div>
      ) : mode === "form" ? (
        <form
          className="meeting-folder-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <h3>{t(key("new"))}</h3>
          <label className="meeting-folder-field">
            <span>{t(key("name"))}</span>
            <input
              dir="auto"
              ref={nameRef}
              aria-label={t(key("name"))}
              autoComplete="off"
              value={draft}
              disabled={busy}
              onInput={(event) => setDraft(event.currentTarget.value)}
              aria-invalid={Boolean(error)}
            />
          </label>
          <div className="meeting-folder-field">
            <span id="meeting-folder-location-label">{t(key("location"))}</span>
            <div className="meeting-folder-location">
              <button
                type="button"
                className="meeting-folder-location-trigger"
                aria-labelledby="meeting-folder-location-label meeting-folder-location-value"
                aria-haspopup="listbox"
                aria-expanded={locationOpen}
                disabled={busy}
                onClick={() => setLocationOpen((open) => !open)}
              >
                <span id="meeting-folder-location-value">
                  {context?.spaces.find((s) => s.id === spaceId)?.kind === "team"
                    ? `${context.spaces.find((s) => s.id === spaceId)?.name} · ${t(key("shared"))}`
                    : t(key("private"))}
                </span>
                <ChevronDown className="size-3" />
              </button>
              {locationOpen && (
                <div
                  data-meeting-region="locations"
                  className="meeting-folder-locations"
                  role="listbox"
                  aria-label={t(key("location"))}
                >
                  {context?.spaces.map((space) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={space.id === spaceId}
                      key={space.id}
                      onClick={() => {
                        setSpaceId(space.id);
                        setLocationOpen(false);
                      }}
                    >
                      {space.kind === "private"
                        ? t(key("private"))
                        : `${space.name} · ${t(key("shared"))}`}
                      {space.id === spaceId && <Check className="size-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {errorView}
          <div className="meeting-folder-form-actions">
            <button type="button" onClick={() => onMode("list")}>
              {t(key("cancel"))}
            </button>
            <button
              type="submit"
              disabled={busy || spaceId === null}
              onClick={(event) => {
                if (event.detail > 0) commitKey.current = false;
              }}
            >
              {t(key("create"))}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="meeting-folder-search">
            <Search className="size-3.5" />
            <input
              dir="auto"
              ref={searchRef}
              role="combobox"
              aria-label={t(key("search"))}
              placeholder={t(key("search"))}
              aria-expanded="true"
              aria-controls="meeting-folder-results"
              aria-activedescendant={
                visible[active] ? `meeting-folder-option-${active}` : undefined
              }
              value={query}
              onInput={(e) => setQuery(e.currentTarget.value)}
            />
            {query && (
              <button aria-label={t(key("clear"))} onClick={() => setQuery("")}>
                <X className="size-3" />
              </button>
            )}
          </div>
          {errorView}
          {!context ? (
            <div className="p-3 text-xs text-muted-foreground">
              <p>{t(key(error ? "unavailable" : "loading"))}</p>
              {error && <button onClick={onRetry}>{t(key("retry"))}</button>}
            </div>
          ) : (
            <>
              <div
                className="meeting-folder-results"
                role="listbox"
                id="meeting-folder-results"
                aria-label={t(key("folders"))}
              >
                {groups.map((group) => (
                  <div key={group.label}>
                    <p className="meeting-folder-group">{group.label}</p>
                    {group.items.map((folder) => {
                      const index = visible.indexOf(folder);
                      const space = context.spaces.find((s) => s.id === folder.space_id);
                      return (
                        <button
                          key={folder.id}
                          id={`meeting-folder-option-${index}`}
                          className={`meeting-folder-option ${index === active ? "active" : ""}`}
                          role="option"
                          aria-selected={
                            folder.id === selected?.folderId && folder.space_id === selected.spaceId
                          }
                          aria-label={meetingFolderLabel(context, folder, t)}
                          disabled={busy}
                          onClick={() =>
                            onSelect({ folderId: folder.id, spaceId: folder.space_id })
                          }
                        >
                          <Folder className="size-3.5 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="meeting-folder-name">
                              {defaultFolderDisplayName(folder, t)}
                            </span>
                            <span className="meeting-folder-space">
                              {space?.kind === "private"
                                ? t(key("private"))
                                : `${space?.name} · ${t(key("shared"))}`}
                            </span>
                          </span>
                          {space?.kind === "team" && <Users className="size-3 shrink-0" />}
                          {folder.id === selected?.folderId && (
                            <Check className="size-3 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
                {!visible.length && (
                  <p className="p-4 text-center text-xs text-muted-foreground">{t(key("empty"))}</p>
                )}
              </div>
              <button className="meeting-folder-new" disabled={busy} onClick={() => onMode("form")}>
                <Plus className="size-3.5" />
                {t(key("new"))}
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
