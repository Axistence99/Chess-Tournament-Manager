/** Image-processing utilities for local, portable player profile pictures. */
/**
 * Convert an uploaded photo into a small square JPEG suitable for localStorage.
 * Center-cropping and compression keep each profile portable in JSON backups
 * without retaining the potentially multi-megabyte source image.
 */
export async function compressAvatar(file: File): Promise<string> {
  const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!supportedTypes.has(file.type)) throw new Error("Unsupported image type");
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error("Image is empty or larger than 10 MB");

  const source = await readAsDataUrl(file);
  const image = await decodeImage(source);
  const pixels = image.naturalWidth * image.naturalHeight;
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth > 8192 ||
    image.naturalHeight > 8192 ||
    pixels > 40_000_000
  )
    throw new Error("Image dimensions are too large");
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");

  const crop = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = (image.naturalWidth - crop) / 2;
  const sourceY = (image.naturalHeight - crop) / 2;
  context.drawImage(image, sourceX, sourceY, crop, crop, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function decodeImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image could not be decoded"));
    image.src = source;
  });
}
