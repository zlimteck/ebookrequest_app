import axiosAdmin from '../axiosAdmin';

// Upload en chunks pour contourner la limite de payload des proxys devant l'instance
// (ex. Cloudflare, 100 Mo sur le plan gratuit, non configurable) — un gros fichier est
// découpé en morceaux envoyés un par un plutôt qu'en une seule requête énorme.
const CHUNK_SIZE = 20 * 1024 * 1024; // 20 Mo par chunk
const CHUNK_THRESHOLD = 80 * 1024 * 1024; // chunking seulement au-delà, marge sous les 100 Mo de Cloudflare

export function shouldChunk(file) {
  return file.size > CHUNK_THRESHOLD;
}

// Retourne { filename, filePath } (filePath du type "books/xxx.epub", déjà dans
// uploads/books) — prêt à être utilisé comme un fichier existant par les endpoints qui
// l'acceptent (ex. PATCH /api/requests/:id/download-link avec existingFilePath).
export async function uploadFileChunked(file, { onProgress } = {}) {
  const { data: initData } = await axiosAdmin.post('/api/admin/chunked-upload/init', { filename: file.name });
  const { uploadId } = initData;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const chunk = file.slice(start, start + CHUNK_SIZE);
      const formData = new FormData();
      formData.append('chunk', chunk, file.name);
      formData.append('uploadId', uploadId);
      formData.append('index', i);

      await axiosAdmin.post('/api/admin/chunked-upload/chunk', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });

      if (onProgress) onProgress(Math.round(((i + 1) / totalChunks) * 100));
    }

    const { data } = await axiosAdmin.post('/api/admin/chunked-upload/finalize', {
      uploadId,
      totalChunks,
      filename: file.name,
    });
    return data;
  } catch (err) {
    axiosAdmin.post('/api/admin/chunked-upload/abort', { uploadId }).catch(() => {});
    throw err;
  }
}
