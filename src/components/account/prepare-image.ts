/**
 * Shrinks the photo in the browser before upload (≈300–600 KB instead of a
 * 3–8 MB camera file): faster on weak connections, and the canvas re-encode
 * already drops EXIF. The server still validates and re-encodes everything.
 */
export async function prepareImage(
  file: File,
  name = "document.jpg",
): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas
      .getContext("2d")
      ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    return blob ? new File([blob], name, { type: "image/jpeg" }) : file;
  } catch {
    return file; // undecodable in this browser: let the server decide
  }
}
