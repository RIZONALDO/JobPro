import { useEffect, useState } from "react";

interface FaviconInfo {
  links: { rel: string; href: string; type: string; sizes: string }[];
  apiStatus: number | null;
  apiContentType: string | null;
  apiSize: string | null;
  imgLoaded: boolean | null;
  imgError: string | null;
  userAgent: string;
  timestamp: string;
}

export default function FaviconDebugPage() {
  const [info, setInfo] = useState<FaviconInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const collect = async () => {
    setLoading(true);
    const links = Array.from(document.querySelectorAll('link[rel*="icon"]')).map(el => {
      const l = el as HTMLLinkElement;
      return { rel: l.rel, href: l.href, type: l.type, sizes: l.getAttribute("sizes") ?? "" };
    });

    const v = Date.now();
    const url = `/api/favicon?v=${v}`;
    let apiStatus: number | null = null;
    let apiContentType: string | null = null;
    let apiSize: string | null = null;

    try {
      const r = await fetch(url, { method: "HEAD" });
      apiStatus = r.status;
      apiContentType = r.headers.get("content-type");
      apiSize = r.headers.get("content-length");
    } catch (e) {
      apiStatus = -1;
    }

    // Test actual image load
    const imgLoaded = await new Promise<boolean>(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });

    setInfo({
      links,
      apiStatus,
      apiContentType,
      apiSize,
      imgLoaded,
      imgError: null,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    });
    setLoading(false);
  };

  useEffect(() => { void collect(); }, []);

  const row = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid #ddd" }}>
      <div style={{ width: 180, fontWeight: 700, color: "#555", flexShrink: 0 }}>{label}</div>
      <div style={{ wordBreak: "break-all", color: "#111" }}>{value}</div>
    </div>
  );

  const badge = (ok: boolean, yes: string, no: string) => (
    <span style={{ background: ok ? "#22c55e" : "#ef4444", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700 }}>
      {ok ? yes : no}
    </span>
  );

  return (
    <div style={{ fontFamily: "monospace", maxWidth: 720, margin: "40px auto", padding: "0 20px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 4 }}>Favicon Debug</h1>
      <p style={{ color: "#888", marginBottom: 20, fontSize: 13 }}>Diagnóstico de carregamento do favicon</p>

      <button
        onClick={collect}
        disabled={loading}
        style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px", fontWeight: 700, cursor: "pointer", marginBottom: 24 }}
      >
        {loading ? "Verificando..." : "Verificar novamente"}
      </button>

      {info && (
        <>
          <section style={{ background: "#f9f9f9", border: "1px solid #ddd", borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Browser</h2>
            {row("User Agent", <span style={{ fontSize: 11 }}>{info.userAgent}</span>)}
            {row("Timestamp", info.timestamp)}
          </section>

          <section style={{ background: "#f9f9f9", border: "1px solid #ddd", borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>
              {"<link> tags no <head>"} ({info.links.length} encontrado{info.links.length !== 1 ? "s" : ""})
            </h2>
            {info.links.length === 0
              ? <div style={{ color: "#ef4444", fontWeight: 700 }}>NENHUM link de favicon encontrado no DOM!</div>
              : info.links.map((l, i) => (
                <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 12 }}>
                  <div><b>rel:</b> {l.rel}</div>
                  <div><b>href:</b> {l.href}</div>
                  <div><b>type:</b> {l.type || "(vazio)"} &nbsp; <b>sizes:</b> {l.sizes || "(vazio)"}</div>
                </div>
              ))
            }
          </section>

          <section style={{ background: "#f9f9f9", border: "1px solid #ddd", borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>API /api/favicon</h2>
            {row("HTTP Status", info.apiStatus === 200 ? badge(true, "200 OK", "") : <span style={{ color: "#ef4444" }}>{info.apiStatus}</span>)}
            {row("Content-Type", info.apiContentType ?? "(nenhum)")}
            {row("Content-Length", info.apiSize ? `${info.apiSize} bytes (${Math.round(Number(info.apiSize)/1024)}KB)` : "(sem content-length)")}
            {row("Imagem carrega?", badge(!!info.imgLoaded, "SIM", "NÃO — erro ao renderizar"))}
          </section>

          <section style={{ background: "#f9f9f9", border: "1px solid #ddd", borderRadius: 10, padding: 20, marginBottom: 20 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, marginBottom: 12 }}>Preview do favicon</h2>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {[16, 32, 64].map(size => (
                <div key={size} style={{ textAlign: "center" }}>
                  <img
                    src={`/api/favicon?v=${Date.now()}`}
                    width={size} height={size}
                    style={{ display: "block", border: "1px solid #ccc", background: "#fff", imageRendering: "pixelated" }}
                    alt={`${size}px`}
                  />
                  <div style={{ fontSize: 10, marginTop: 4, color: "#888" }}>{size}px</div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
