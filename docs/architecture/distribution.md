# Prepared 3D models and synthetic examples


## Casa Mirador demo exterior

The public demo's exterior image is exported directly from the same `DistributionViewer` and fictional Casa Mirador model used by **House Distribution 3D**. Its footprint, walls, door and window openings, gable roof, front timber pergola, terrace and property boundary come from `lib/demo-distribution.ts`. The pergola and terrace are modeled architectural faces, visible in the ordinary exterior volume as well as Presentation. A 4.20 m glazed living-room door opens onto that terrace. The eight rooms retain their 12 × 10 m enclosed footprint and 120 m² total floor area; exterior additions do not increase those room quantities.

The pergola spans 8.90 × 3.05 m with two front posts and six rafters; its top is at +2.85 m. The terrace spans 8.90 × 3.25 m with its top at -0.06 m. The timber members and terrace have closed faces so orbiting the model preserves their undersides. In **Furniture → Show complete house → Presentation**, the viewer renders the same proposed layout used by its selectable inventory, plus presentation lighting, materials, planting, ground and an entrance path aligned with the modeled door. The technical Distribution view remains unfurnished, including in Presentation. The terrace furniture sits on the modeled deck elevation and can be selected and inspected from its inventory. Those furniture sizes, finishes and landscape elements are illustrative; the demo's dimensions and sources remain fictional.

To regenerate the 1800 × 1200 WebP, start a local server and run the exporter in a second terminal:

```powershell
npm run dev -- --webpack --hostname 127.0.0.1 --port 3100
node scripts/render-demo-exterior.mjs http://127.0.0.1:3100
```

The exporter opens the actual demo viewer, selects its internal Furniture tab, volume and Presentation, and captures its furnished canvas. It also generates `public/demo/casa-mirador-plan.svg` from the same model using `scripts/demo-plan-svg.mjs`. It writes the exterior WebP, plan SVG and `lib/demo-exterior-render.json` together. The manifest records architectural geometry, furniture layout, image and plan SHA-256 hashes plus image dimensions. Furniture hashes include piece dimensions, positions, rotations, elevations and exterior-zone geometry, excluding translated labels. Regenerate these files after architectural, furniture or presentation changes. Focused tests verify the assets against the current geometry and furniture, require identical English and Spanish geometry and placements, and check the asset digests and image resolution. The other demo room illustrations remain conceptual references.

Models are bounded JSON validated by [parseHouseModel](../../lib/house-distribution.ts).
The server imports an explicitly reviewed package; uploading a plan does not trigger conversion,
AI calls or a paid preparation job. [Stored models](../../lib/house-distribution-store.ts) retain
original geometry plus separate corrections and optimistic revisions.

## Source and measurement rules

Every model names permitted source document IDs. [Import and read routes](../../app/api/house-distribution/route.ts)
recheck project, section and source access. Encrypted sources are categorically excluded.
Coordinates and display meshes are not certified construction quantities. Measurement fields
distinguish documented, approximate and unconfirmed evidence; missing values remain null.

The synthetic generator creates a compact, invented pavilion with several rooms, openings,
fixture mounts and an illustrative roof. It is not traced or rescaled from a client plan:

```powershell
node scripts/prepare-demo-house.mjs
```

It writes an ignored `outputs/house-distribution/demo-house.json`. Its source ID is fictional;
it does not upload or import anything. Use your own authorized sources for a real project.

## Export and geometry validation

[Exports](../../lib/distribution-export.ts) preserve effective corrections and original geometry,
include measurement/source manifests, escape SVG content, validate supplied PNG references and
produce UTF-8 ZIP filenames. Rendered images supplement model JSON; they do not replace it.

[Synthetic parser tests](../../tests/synthetic-house-distribution.test.ts),
[light geometry tests](../../tests/synthetic-distribution-light-geometry.test.ts), and
[export tests](../../tests/synthetic-distribution-export.test.ts) validate these behaviors without
embedding an actual building. Route/source access remains covered by
[store tests](../../tests/house-distribution-store.test.ts) and [browser scenarios](../../e2e/distribution.spec.ts).


## Furniture proposals

Distribution 3D contains the Model / Modelo and Furniture / Mobiliario tabs in real projects
and the public demo. Furniture uses `/projects/{projectId}/distribution/furniture`; shared links
use this canonical path. Existing `/projects/{projectId}/furniture` and root `?section=furniture`
links remain compatible. Furniture inherits Distribution access and its authenticated
document-source checks. It does not introduce a new persisted membership permission or write
furniture records to the database.

The [planner](../../lib/furniture-layout.ts) uses authorized runtime room polygons, doors,
windows and known heights. It reserves a continuous 0.90 m entrance route only where geometry
confirms an open adjoining interior room. Appliances, counters and bathroom pieces back onto
actual modeled walls; a dedicated refrigerator outlet guides the appliance proposal before
adjacent cabinets are fitted. Bathroom outlets are visual cues, not confirmed plumbing points.
Compact bathroom pieces and transparent shower glazing can fit beside windows; opaque tall
pieces avoid them. Pieces that cannot fit are omitted.

Furniture dimensions and finishes are suggestions, distinct from documented house measurements.
The selectable [catalog](../../app/components/furniture-catalog.ts) includes a footprint fallback
when WebGL is unavailable. Distribution retains its unfurnished technical view, export packages,
section-derived heights, roof geometry and source references.

The public preview uses the independently invented [demo model](../../lib/demo-distribution.ts).
Private project coordinates, model exports and preview captures are not bundled as public assets.
