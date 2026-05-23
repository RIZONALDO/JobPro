import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarDisplay } from "@/components/ui/avatar-display";

export interface SubtaskRow {
  id: string; // local key
  title: string;
  editorId: string; // "" means unassigned
  dueDate: string;
}

interface Editor {
  id: number;
  name: string;
  avatarUrl?: string | null;
}

interface SubtaskFormRowProps {
  row: SubtaskRow;
  index: number;
  editors: Editor[];
  onChange: (patch: Partial<SubtaskRow>) => void;
  onRemove: () => void;
}

export function SubtaskFormRow({ row, index, editors, onChange, onRemove }: SubtaskFormRowProps) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center py-2 px-3 rounded-lg border bg-background">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Subtarefa {index + 1}
        </span>
        <Input
          value={row.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder="Título da subtarefa"
          className="text-sm h-8"
        />
      </div>

      {/* Editor */}
      <div className="w-40">
        <Select value={row.editorId || "none"} onValueChange={v => onChange({ editorId: v === "none" ? "" : v })}>
          <SelectTrigger className="text-xs h-8">
            {row.editorId ? (
              (() => {
                const e = editors.find(x => String(x.id) === row.editorId);
                return e ? (
                  <span className="flex items-center gap-1.5">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} style={{ width: 18, height: 18, fontSize: 7, flexShrink: 0 }} />
                    <span className="truncate">{e.name}</span>
                  </span>
                ) : <SelectValue />;
              })()
            ) : (
              <SelectValue placeholder="Editor…" />
            )}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem editor</SelectItem>
            {editors.map(e => (
              <SelectItem key={e.id} value={String(e.id)}>
                <span className="flex items-center gap-1.5">
                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} style={{ width: 18, height: 18, fontSize: 7, flexShrink: 0 }} />
                  {e.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Prazo */}
      <div className="w-36">
        <Input
          type="date"
          value={row.dueDate}
          onChange={e => onChange({ dueDate: e.target.value })}
          className="text-xs h-8"
          title="Prazo da subtarefa"
        />
      </div>

      {/* Remover */}
      <button
        type="button"
        onClick={onRemove}
        className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-red-600 transition-colors"
        title="Remover subtarefa"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
