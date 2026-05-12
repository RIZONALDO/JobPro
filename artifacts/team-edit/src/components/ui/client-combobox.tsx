import { useEffect, useRef, useState } from "react";
import { apiFetch, apiPost } from "@/lib/api";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface Client { id: number; name: string; }

interface Props {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function ClientCombobox({ value, onChange, placeholder = "Buscar ou criar cliente…", disabled }: Props) {
  const [clients, setClients] = useState<Client[]>([]);
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<Client[]>("/api/clients").then(setClients).catch(() => {});
  }, []);

  // Sync query when value changes externally
  useEffect(() => { setQuery(value); }, [value]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = query.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : clients;

  const exactMatch = clients.some(c => c.name.toLowerCase() === query.trim().toLowerCase());
  const showCreate = query.trim().length > 0 && !exactMatch;

  const select = (name: string) => {
    onChange(name);
    setQuery(name);
    setOpen(false);
  };

  const createClient = async () => {
    const name = query.trim();
    if (!name) return;
    const created = await apiPost<Client>("/api/clients", { name });
    setClients(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
    select(created.name);
  };

  const clear = () => { onChange(""); setQuery(""); inputRef.current?.focus(); };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); onChange(e.target.value); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm shadow-sm transition-colors",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
        />
        {query ? (
          <button type="button" onClick={clear}
            className="absolute right-2 text-muted-foreground hover:text-foreground transition-colors text-xs font-bold">
            ✕
          </button>
        ) : (
          <ChevronsUpDown className="absolute right-2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
        )}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-[hsl(var(--card))] shadow-md max-h-56 overflow-y-auto">
          {filtered.length === 0 && !showCreate && (
            <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
          )}
          {filtered.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => select(c.name)}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors text-left"
            >
              <Check className={cn("h-3.5 w-3.5 shrink-0", value === c.name ? "opacity-100 text-primary" : "opacity-0")} />
              {c.name}
            </button>
          ))}
          {showCreate && (
            <button
              type="button"
              onClick={createClient}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-primary hover:bg-accent transition-colors border-t"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              Criar "{query.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
