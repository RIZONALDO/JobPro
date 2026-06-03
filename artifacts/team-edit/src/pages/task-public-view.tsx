import { useEffect, useState } from "react";
import { Download, Film, Music, AlertCircle } from "lucide-react";

interface PublicFile {
  id: number;
  fileName: string;
  fileSize: number | null;
  mimeType: string | null;
  taskTitle: string | null;
  taskCode: string | null;
  client: string | null;
  streamUrl: string;
}

function fmtSize(b: number | null) {
  if (!b) return "";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TaskPublicView() {
  const token = window.location.pathname.split("/p/")[1]?.split("/")[0];
  const [file,    setFile]    = useState<PublicFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/${token}`)
      .then(r => { if (!r.ok) throw new Error("Link inválido ou expirado"); return r.json(); })
      .then(setFile)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const isVideo = file?.mimeType?.startsWith("video/");
  const isAudio = file?.mimeType?.startsWith("audio/");

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-white/60 animate-spin" />
    </div>
  );

  if (error || !file) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#0a0a0a] text-white">
      <div className="h-16 w-16 rounded-2xl bg-red-500/10 flex items-center justify-center">
        <AlertCircle className="h-8 w-8 text-red-400" />
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold">Link inválido</p>
        <p className="text-sm text-white/40 mt-1">{error ?? "Este link não existe ou foi revogado."}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex flex-col">

      {/* Header */}
      <div className="border-b border-white/8 px-6 py-4 flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {file.taskCode && (
              <span className="font-mono text-xs text-white/30 shrink-0">{file.taskCode}</span>
            )}
            <h1 className="text-sm font-semibold truncate">{file.taskTitle ?? "Sem título"}</h1>
          </div>
          {file.client && (
            <p className="text-xs text-white/35 mt-0.5">{file.client}</p>
          )}
        </div>
        <a
          href={`/api/public/${token}/download`}
          download={file.fileName}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/12 transition-colors shrink-0 ml-4"
        >
          <Download className="h-3.5 w-3.5" />
          Baixar
        </a>
      </div>

      {/* Player */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
        {isVideo && (
          <video
            controls
            className="w-full max-w-4xl rounded-xl shadow-2xl bg-black"
            style={{ maxHeight: "70vh" }}
          >
            <source src={`/api/public/${token}/stream`} type={file.mimeType ?? "video/mp4"} />
            Seu navegador não suporta o player de vídeo.
          </video>
        )}
        {isAudio && (
          <div className="w-full max-w-lg">
            <div className="bg-white/5 rounded-2xl p-8 flex flex-col items-center gap-6 border border-white/8">
              <div className="h-20 w-20 rounded-2xl bg-violet-500/20 flex items-center justify-center">
                <Music className="h-10 w-10 text-violet-400" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold">{file.fileName}</p>
                <p className="text-xs text-white/35 mt-1">{fmtSize(file.fileSize)}</p>
              </div>
              <audio controls className="w-full">
                <source src={`/api/public/${token}/stream`} type={file.mimeType ?? "audio/mpeg"} />
              </audio>
            </div>
          </div>
        )}
        {!isVideo && !isAudio && (
          <div className="flex flex-col items-center gap-4">
            <div className="h-20 w-20 rounded-2xl bg-white/5 flex items-center justify-center">
              <Film className="h-10 w-10 text-white/20" />
            </div>
            <p className="text-sm text-white/40">{file.fileName}</p>
            <a
              href={`/api/public/${token}/download`}
              download={file.fileName}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 transition-colors text-sm font-medium"
            >
              <Download className="h-4 w-4" />
              Baixar arquivo
            </a>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-white/8 px-6 py-3 text-center">
        <p className="text-[10px] text-white/15">JobPro · Visualização de entrega</p>
      </div>
    </div>
  );
}
