import exterior from "../public/demo/casa-mirador-exterior.webp";

// A new export must also invalidate optimized images and already-open demo pages.
export const DEMO_EXTERIOR_IMAGE_SRC = typeof exterior === "string" ? exterior : exterior.src;
