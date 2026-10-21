import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { AvatarDisplay } from "@/components/ui/avatar-display";

/** Texto com @menção: campo que sugere pessoas ao digitar @, e helpers para achar e destacar as menções. */

export interface MentionUser { id: number; name: string; avatarUrl: string | null }

export function parseMentions(text: string, users: MentionUser[]): number[] {
  const ids: number[] = [];
  const matches = text.match(/@([\w][\w\s]{0,30})/g) ?? [];
  for (const m of matches) {
    const q = m.slice(1).trim().toLowerCase();
    const found = users.find(u => u.name.toLowerCase() === q);
    if (found && !ids.includes(found.id)) ids.push(found.id);
  }
  return ids;
}

export function renderMentions(text: string) {
  const parts = text.split(/(@[\w][\w\s]{0,30})/g);
  return parts.map((part, i) =>
    part.startsWith("@")
      ? <span key={i} className="text-[hsl(var(--primary))]">{part}</span>
      : <span key={i}>{part}</span>
  );
}

// ── MentionTextarea ───────────────────────────────────────────────

export function MentionTextarea({
  value, onChange, onSend, users, placeholder, rows = 1, className,
}: {
  value: string; onChange: (v: string) => void; onSend?: () => void;
  users: MentionUser[]; placeholder?: string; rows?: number; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [showDrop, setShowDrop] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  const [query, setQuery] = useState("");
  const [atIndex, setAtIndex] = useState(-1);
  const [selIdx, setSelIdx] = useState(0);

  const filtered = users
    .filter(u => !query || u.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 6);

  const checkAt = (val: string, cursor: number) => {
    const before = val.slice(0, cursor);
    const m = before.match(/@([\w\s]{0,30})$/);
    if (m && !m[1].startsWith(" ")) {
      setQuery(m[1]); setAtIndex(before.length - m[0].length); setShowDrop(true); setSelIdx(0);
    } else { setShowDrop(false); }
  };

  const selectUser = (u: MentionUser) => {
    const cursor = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, atIndex);
    const after = value.slice(cursor);
    onChange(`${before}@${u.name} ${after}`);
    setShowDrop(false);
    setTimeout(() => {
      if (!ref.current) return;
      const pos = before.length + u.name.length + 2;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showDrop && filtered.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx(i => Math.min(i + 1, filtered.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setSelIdx(i => Math.max(0, i - 1)); return; }
      if (e.key === "Enter")     { e.preventDefault(); if (filtered[selIdx]) selectUser(filtered[selIdx]); return; }
      if (e.key === "Escape")    { setShowDrop(false); return; }
    }
    if (e.key === "Enter" && !e.shiftKey && onSend) { e.preventDefault(); onSend(); }
  };

  return (
    <div className="relative">
      <Textarea
        ref={ref}
        value={value}
        onChange={e => { onChange(e.target.value); checkAt(e.target.value, e.target.selectionStart ?? 0); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setShowDrop(false), 150)}
        placeholder={placeholder}
        rows={rows}
        className={cn("resize-none overflow-hidden border-none shadow-none focus-visible:ring-0 bg-transparent p-0 text-sm placeholder:text-[hsl(var(--muted-foreground))]", className)}
      />
      {showDrop && filtered.length > 0 && (
        <div className="absolute bottom-[calc(100%+6px)] left-0 w-56 rounded-xl border bg-[hsl(var(--card))] shadow-2xl z-[200] overflow-hidden">
          <div className="px-3 py-1.5 border-b bg-[hsl(var(--muted))]/30">
            <span className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wide">Mencionar</span>
          </div>
          {filtered.map((u, i) => (
            <button key={u.id} type="button" onMouseDown={e => { e.preventDefault(); selectUser(u); }}
              className={cn("flex items-center gap-2 w-full px-3 py-2 text-xs text-left transition-colors",
                i === selIdx ? "bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]" : "hover:bg-[hsl(var(--muted))]"
              )}>
              <AvatarDisplay name={u.name ?? "?"} avatarUrl={u.avatarUrl} size={24} />
              <span className="font-medium truncate">@{u.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
