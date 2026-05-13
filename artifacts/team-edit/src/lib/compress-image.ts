const MAX_PX = 256;
const QUALITY = 0.82;

export async function compressAvatar(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w0, naturalHeight: h0 } = img;
      const scale = Math.min(1, MAX_PX / Math.max(w0, h0));
      const w = Math.round(w0 * scale);
      const h = Math.round(h0 * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Canvas não disponível")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        blob => { blob ? resolve(blob) : reject(new Error("Falha ao comprimir imagem")); },
        "image/webp",
        QUALITY,
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Falha ao carregar imagem")); };
    img.src = objectUrl;
  });
}

export async function uploadAvatar(file: File): Promise<string> {
  const blob = await compressAvatar(file);
  const form = new FormData();
  form.append("avatar", blob, "avatar.webp");
  const res = await fetch("/api/upload/avatar", { method: "POST", body: form, credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Upload falhou");
  }
  const { url } = await res.json() as { url: string };
  return url;
}
