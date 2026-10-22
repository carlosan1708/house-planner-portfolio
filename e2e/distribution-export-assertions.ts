import { expect } from "@playwright/test";
import type JSZip from "jszip";
import sharp from "sharp";

/** Decode exported references so an empty or malformed capture cannot pass ZIP QA. */
export async function expectDistributionExportImages(zip: JSZip, recordRevision: number, sceneAvailable: boolean) {
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  const paths = ["imagenes/planta.png", ...(sceneAvailable ? ["imagenes/vista-3d.png"] : [])];
  const files = Object.values(zip.files).filter(file => !file.dir).map(file => file.name);
  expect([...manifest.files].sort()).toEqual(files.sort());
  expect(manifest.images.map((image: { path: string }) => image.path).sort()).toEqual([...paths].sort());
  expect(zip.file("imagenes/vista-3d.png") !== null).toBe(sceneAvailable);
  for (const path of paths) {
    const file = zip.file(path);
    expect(file, `Exported visual reference ${path}`).not.toBeNull();
    const bytes = await file!.async("nodebuffer");
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(4096);
    expect(height).toBeLessThanOrEqual(4096);
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ format: "png", width, height });
    const stats = await sharp(bytes).stats();
    expect(stats.channels.slice(0, 3).some(channel => channel.max > channel.min), `${path} contains rendered geometry`).toBe(true);
    expect(manifest.images.find((image: { path: string }) => image.path === path)).toMatchObject({
      recordRevision, evidence: "approximate", note: expect.any(String), purpose: expect.any(String),
    });
    expect(manifest.images.find((image: { path: string }) => image.path === path).note.trim()).not.toBe("");
  }
  return manifest;
}
