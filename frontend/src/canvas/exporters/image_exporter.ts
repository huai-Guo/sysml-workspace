export interface ImageExportOptions {
  scale?: 1 | 2 | 4;
  background?: "white" | "transparent" | "blueprint";
}

export class ImageExporter {
  public static async exportPngBlob(
    svgString: string,
    width: number,
    height: number,
    options: ImageExportOptions = {},
  ): Promise<Blob> {
    const scale = options.scale || 2;
    const bg = options.background || "blueprint";

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not acquire 2d context for image export");

    // Fill background
    if (bg === "white") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (bg === "blueprint") {
      ctx.fillStyle = "#0d1219";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } // transparent does nothing

    ctx.scale(scale, scale);

    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = (e) => reject(new Error("Failed to load SVG for PNG rasterization"));
      img.src = url;
    });

    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob returned null"));
      }, "image/png");
    });
  }
}
