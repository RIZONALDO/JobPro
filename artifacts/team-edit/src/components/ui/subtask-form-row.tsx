import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AvatarDisplay } from "@/components/ui/avatar-display";

export interface SubtaskRow {
  id: string;
  title: string;
  editorId: string;
  dueDate: string; // kept in interface for compat but not shown in UI (parent dueDate applies)
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
    <div className="flex items-center gap-2">
      {/* Index pill */}
      <span className="h-5 w-5 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
        {index + 1}
      </span>

      {/* Título — flex-1 */}
      <Input
        value={row.title}
        onChange={e => onChange({ title: e.target.value })}
        placeholder={`Subtarefa ${index + 1}…`}
        className="flex-1 text-sm h-8 min-w-0"
      />

      {/* Editor — largura fixa */}
      <div className="w-36 shrink-0">
        <Select value={row.editorId || "none"} onValueChange={v => onChange({ editorId: v === "none" ? "" : v })}>
          <SelectTrigger className="text-xs h-8 w-full">
            {row.editorId ? (
              (() => {
                const e = editors.find(x => String(x.id) === row.editorId);
                return e ? (
                  <span className="flex items-center gap-1.5 min-w-0">
                    <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} style={{ width: 16, height: 16, fontSize: 6, flexShrink: 0 }} />
                    <span className="truncate">{e.name.split(" ")[0]}</span>
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
                  <AvatarDisplay name={e.name} avatarUrl={e.avatarUrl} style={{ width: 16, height: 16, fontSize: 6, flexShrink: 0 }} />
                  {e.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Remover */}
      <button
        type="button"
        onClick={onRemove}
        className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shrink-0"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
