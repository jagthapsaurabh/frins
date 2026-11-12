/**
 * Reading files into the page.
 *
 * Photos come off a phone camera at several megabytes. They are shrunk before
 * upload so a learner can attach a few screenshots without waiting, and so the
 * database does not fill up with 12 MB photos of a chart.
 */

const IMAGE_MAX_SIDE = 1600;
const IMAGE_QUALITY = 0.85;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_FILES_PER_SEND = 8;

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const readAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });

const shrinkImage = (dataUrl: string): Promise<string> =>
  new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(image.width, image.height));
      if (scale >= 1 && dataUrl.length < 900_000) {
        resolve(dataUrl);
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      if (!context) {
        resolve(dataUrl);
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
    };
    image.onerror = () => resolve(dataUrl);
    image.src = dataUrl;
  });

export interface PreparedFile {
  name: string;
  mime: string;
  data: string;
  size: number;
}

/** Read one file, shrinking photos and rejecting anything over the limit. */
export const prepareFile = async (file: File): Promise<PreparedFile> => {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is over 8 MB. Compress it and try again.`);
  }
  const raw = await readAsDataUrl(file);
  const data = file.type.startsWith('image/') ? await shrinkImage(raw) : raw;
  const mime = data.startsWith('data:image/jpeg') ? 'image/jpeg' : file.type || 'application/octet-stream';
  return {
    name: file.name,
    mime,
    data,
    size: Math.round((data.length * 3) / 4)
  };
};

/** Open a stored data URL in a new tab, for a PDF or a full-size photo. */
export const openStoredFile = async (dataUrl: string, name: string, mime: string) => {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      const link = document.createElement('a');
      link.href = url;
      link.download = name || 'file';
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = name || 'file';
    link.download = mime === 'application/pdf' ? `${name || 'file'}.pdf` : name || 'file';
    link.click();
  }
};
