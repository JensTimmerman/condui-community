# Condui portable project file format

This document specifies the local project archive that Condui reads and writes. It is the compatibility contract for project backup, transfer, and self-hosted use. It intentionally documents portable project data only. Hosted-service behavior is not part of this format.

The implementation sources of truth are:

- `apps/app/src/types/projectV2.ts` for the current JSON document types;
- `apps/app/src/lib/projectV2/migration.ts` for accepted schema versions and normalization;
- `apps/app/src/editions/community/communityProjectPackage.ts` for local archive reading and writing.

## Archive

A project file is a DEFLATE-compressed ZIP archive. File names use `/` separators and are relative to the archive root.

| Path | Required | Purpose |
| --- | --- | --- |
| `project.json` | Yes | The persisted project document. |
| `manifest.json` | Written by Condui | Informational archive metadata. The importer does not rely on it. |

Readers must ignore unrecognized archive entries. Portable local archives keep project-owned payloads as data URLs inside `project.json`; the local writer does not create separate source-sidecar entries.

The current manifest has archive format version `1`, the format label `condui-project`, and the `project.json` entry name. The archive-format version and the project schema version are independent.

## `project.json`

The current schema version is `2.1.0`.

The root document contains these portable domains:

| Field | Role |
| --- | --- |
| `schemaVersion` | Project JSON schema discriminator. |
| `project` | Identity, name, timestamps, locale, customer/installation metadata, and local editor resume settings. |
| `site` | Optional installation address and geographic context. |
| `building` | Floors, shared plan calibration, spaces, and optional georeferencing. |
| `systems` | Stable system records referenced by layers and elements. |
| `layers` | Display/export grouping for building, electrical, and annotation content. |
| `elements` | Persisted geometry and element properties. |
| `relationships` | Directed links between elements. |
| `views` | Floor-plan, one-wire, panel, and export view definitions. |
| `assets` | Metadata and references for floor-plan and other project-owned files. |
| `disciplines.electrical` | Installation, panels, devices, plan wiring, and one-wire annotations. |
| `validation` | Optional quarantined data retained for recovery and diagnostics. |

Some current documents also require the reserved compatibility containers `collaboration`, `comments`, and `chronology`. Local implementations must preserve unknown members in these containers and use the neutral values produced by `createEmptyProjectV2` or the official migration code rather than constructing them by hand. They must not infer local permissions or enable features from their contents.

These containers are named only because removing or rewriting them can make loading or round trips lossy. Their internal service-side interpretation is outside the portable format.

IDs are opaque strings. References such as `floorId`, `panelId`, `systemId`, `layerId`, `assetId`, `fromElementId`, and `toElementId` must resolve within the same document unless the field is explicitly optional. Timestamps are ISO 8601 strings.

An importer may replace the root `project.id` when the imported identity collides with a project that cannot be overwritten. This creates a distinct project copy; entity and asset IDs inside the document remain unchanged so their internal references stay valid.

## Project-owned assets

Floor-plan images, processed images, vectors, and local installer artwork are stored in the project fields that own them. Binary payloads use standard data URLs; SVG content may be stored as SVG text where the schema permits it. Readers must preserve unrecognized asset metadata but must not fetch or execute unknown content automatically.

## Compatibility and normalization

The loader accepts:

- `2.1.0`, the current native format;
- `2.0.0`, upgraded by adding the current scope contract;
- `0.2.0`, migrated through the legacy V1-to-V2 importer.

Other schema versions are rejected. New writers must emit the current version and serialize through `projectToStoredProjectV2`. Runtime-only compatibility aliases must not be written to `project.json`.

Import validation requires, after normalization:

- a non-empty `project.id`;
- a `project` object;
- a floor array in the current or accepted legacy location;
- a panel array in the current or accepted legacy location;
- a structurally valid project according to `validateProjectStructure`.

A missing project name is repaired to a localized import fallback name. Obsolete oversized V2 documents containing the recognized legacy embedded-image shape receive a narrowly scoped migration exception.

## Import limits

The importer enforces these defensive limits:

| Limit | Value |
| --- | ---: |
| `project.json` | 160 MiB |

Archive producers should stay comfortably below these limits. Consumers must not trust paths, MIME types, dimensions, identifiers, or JSON properties merely because they appear in an archive.

## Change policy

Format changes must be forward-migratable and preserve existing local projects. A meaningful change includes adding or moving persisted fields, changing required defaults, changing asset-path behavior, accepting or rejecting a schema version, modifying archive entries used for loading, or changing an import limit.

Every such change must update this document and add or adjust community archive round-trip tests or the relevant migration tests.
