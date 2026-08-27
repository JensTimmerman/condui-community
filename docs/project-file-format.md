# Condui portable project file format

This document specifies the local project archive that Condui reads and writes. It is the compatibility contract for project backup, transfer, and self-hosted use. It intentionally documents portable project data only. Hosted-service behavior is not part of this format.

The implementation sources of truth are:

- `apps/app/src/types/projectV2.ts` for the current JSON document types;
- `apps/app/src/lib/projectV2/migration.ts` for accepted schema versions and normalization;
- `apps/app/src/editions/community/communityProjectPackage.ts` for local archive reading and writing.

## Archive

A project file is a DEFLATE-compressed ZIP archive. File names use `/` separators and are relative to the archive root.

| Path            | Required          | Purpose                                                           |
| --------------- | ----------------- | ----------------------------------------------------------------- |
| `project.json`  | Yes               | The persisted project document.                                   |
| `manifest.json` | Written by Condui | Informational archive metadata. The importer does not rely on it. |

Readers must ignore unrecognized archive entries. Portable local archives keep project-owned payloads as data URLs inside `project.json`; the local writer does not create separate source-sidecar entries.

The current manifest has archive format version `1`, the format label `condui-project`, and the `project.json` entry name. The archive-format version and the project schema version are independent.

## `project.json`

The current schema version is `2.1.0`.

The root document contains these portable domains:

| Field                    | Role                                                                                                  |
| ------------------------ | ----------------------------------------------------------------------------------------------------- |
| `schemaVersion`          | Project JSON schema discriminator.                                                                    |
| `project`                | Identity, name, timestamps, locale, customer/installation metadata, and local editor resume settings. |
| `site`                   | Optional installation address and geographic context.                                                 |
| `building`               | Floors, shared plan calibration, spaces, and optional georeferencing.                                 |
| `systems`                | Stable system records referenced by layers and elements.                                              |
| `layers`                 | Display/export grouping for building, electrical, and annotation content.                             |
| `elements`               | Persisted geometry and element properties.                                                            |
| `relationships`          | Directed links between elements.                                                                      |
| `views`                  | Floor-plan, one-wire, panel, and export view definitions.                                             |
| `assets`                 | Metadata and references for floor-plan and other project-owned files.                                 |
| `disciplines.electrical` | Installation, panels, devices, plan wiring, one-wire annotations, and optional supply assemblies.     |
| `validation`             | Optional quarantined data retained for recovery and diagnostics.                                      |

The optional `project.showInspectionAgencyInInfoBlock` boolean controls whether the
portable inspection-agency contact stored in `project.inspectionAgency` is rendered as
a fourth column in drawing info blocks. Missing or `false` leaves the standard
three-column info block unchanged.

Within `disciplines.electrical`, a protection record with `directPanelFeeder: true` is a
structural one-wire carrier for a secondary panel connected directly to a busbar. It
retains the feeder circuit and `subPanelId`, but readers must not interpret it as a
physical protection device or render a protection symbol.

`disciplines.electrical.supplyAssemblies` optionally stores source-side electrical
topology before a root feed or panel input. Each assembly owns a versioned port graph,
its incoming attachment, load handoffs, inverter grouping, and connection properties.
`auxiliaryEnclosures` optionally stores referenced non-panel electrical enclosures.
An auxiliary enclosure may persist `ownerPanelId`, `panelViewPosition`, and a
`gridView` whose slots arrange supply devices in a virtual frame on the panel canvas.
The hierarchy derives the frame's vertical transition band between the shared supply
and its owning main panel; the persisted position remains a horizontal placement hint
and a compatibility value for older editors.
It is a visual mounting boundary rather than another distribution panel. A supply
trunk device may persist `panelMounting` with `kind: "grid"`, `kind: "panel"`, or
`kind: "auxiliary"`; this device-owned value is authoritative for which panel-canvas
frame contains it and does not change its electrical feed order or ownership. Grid
slots remain layout data only. Older files that stored the same mounting on a mirrored
supply-node `mounting.enclosure` remain accepted and are promoted to device-owned
mounting when edited. Deleting the
virtual frame returns its mounted devices to the owning panel's first available grid
positions, using the panel overflow band when necessary, without deleting or rewiring
them. Missing arrays mean that the project has no supply-assembly data. The
existing one-wire, panel, and situation-plan canvases derive the representations they
need from the same topology.

A physical supply-assembly node may contain `deviceId`, referencing its canonical
supply-trunk device record. The device record owns editable physical presentation and
equipment data such as symbol, label, rating, manufacturer, model, serial information,
and situation-plan placements. The graph node owns electrical ports, conductors,
connections, and topology-specific behavior. The referenced device owns physical
panel-canvas mounting. Node-level `label`,
`symbol`, and equipment-property values remain readable as legacy fallback snapshots,
but readers must prefer the referenced device and must not require those snapshots to
be synchronized after edits. Virtual utility, handoff, and distribution nodes may omit
`deviceId`.

An assembly may contain `oneWireGeometry`. Its node positions and optional connection
waypoints are independent geometry on the existing one-wire canvas; they are not
properties of the utility source or main panel.

A supply-trunk device may use `type: "changeover"` with
`symbol: "source_changeover"`. It occupies the same ordered one-wire supply slots as
other trunk devices; it is not free-positioned canvas geometry. A changeover and its
branch devices belong to a root-panel feed and must not be stored on the shared feed
before the root-panel boundary.
Supply-trunk devices may contain `supplyPath: "backup"` for the converter,
`"backup-output"` for serial protection between the converter backup output and the
changeover, `"changeover-grid"` for serial devices on the grid-only lower lane before
the changeover grid tap, or `"converter-grid"` for serial protection between that tap
and the converter grid input. A `"converter-grid"` device is inline on the horizontal
run by default; `converterGridPlacement: "input-leg"` places it on the converter's
vertical input leg. An inverter trunk device may persist
`converterGridInputConnected: false` to represent an intentionally isolated grid AC
input; missing means connected for backward compatibility. A disconnected grid input
has no `inverter-grid-ac` assembly connection and cannot own `converter-grid`
protection devices. Without a changeover it requires separate grid and backup panel
bus sections; an external changeover may instead feed one shared switchable bus. A
changeover-less grid-connected storage branch uses
`"converter-branch"` for its inverter or rectifier and `"converter-dc"` for a battery
or solar source connected to its DC port. Missing `supplyPath` (or `"serial"`) means
the ordinary grid-to-panel path. A converter and its branch devices are mirrored by
nodes in the corresponding supply assembly; the graph connections remain the
electrical source of truth for protected AC and DC paths. Direct storage branches use
the explicit `grid_connected_storage_branch` preset intent and do not require a
changeover. They may optionally feed one protected load circuit from the converter's
backup AC port. That circuit persists `supplySource: { kind: "converter-backup",
converterId }`; the matching assembly handoff initially targets `circuit-input` and may
be retargeted to `panel-input` when the circuit feeds a neighboring secondary panel.
Missing `supplySource` retains the ordinary bus-fed circuit behavior.

Load-time compatibility repair must preserve supply devices and assembly graphs it
cannot assign unambiguously. Inconsistent ownership, a missing converter counterpart,
or an unsupported graph must be reported for validation or manual repair; readers must
not silently delete or flatten those records while opening the project.

Supply changeovers may persist independent `changeoverProps.port1Label` and
`changeoverProps.port2Label` display text. Their visibility uses the device's generic
`symbolLabelDisplay.visibility` map. Supply-assembly connections may carry independent
`wireProperties`; one-wire segments derived from those connections retain the assembly
and connection identity so edits to inverter inputs, backup outputs, changeover inputs,
and separate DC branches do not mutate the ordinary main-supply wire settings.
Supply-wire conversion devices may persist one shared
`conversionProps.acPhaseAssignment`. It applies to every AC port of that converter and
to the corresponding assembly connections, independently of the selected cable's core
count. A multiplied inverter may instead persist ordered
`conversionProps.acPhaseAssignments`, mapped one-to-one to its ordered physical units.
Two-unit inverter groups use those independent assignments; three-unit groups derive a
locked full three-phase set and distribute one line phase per unit. A missing value
inherits the installation voltage system.

SPD protection records and SPD trunk devices may optionally contain
`surgeProtectionKind`. The accepted values are `standard` for one-arrow lightning
protection and `sparkGap` for the two-arrow spark gap. A missing value is
backward-compatible and renders as `standard`.

Electrical circuits may optionally contain `phaseAssignment`. The value identifies the
active AC phases carried by that circuit (`L1`, `L2`, `L3`, and optionally `N`) and its
shape (`single_phase`, `phase_to_phase`, or `three_phase`). The same optional field may
appear on a domain wire override or section wire override when that wire has a more
specific assignment. Missing assignments are backward-compatible. On three-phase
installations, readers may derive the assignment from the circuit's busbar slot;
otherwise the wire inherits the active phases from its upstream source. A concrete
reduced assignment inherited from an upstream circuit locks the downstream phase set.
`showPhaseLabel` is an optional boolean on circuits and wire
overrides; it defaults to false and controls the optional one-wire phase annotation.
`PE` is not part of the assignment because it remains a continuity conductor. The
wire editor narrows available conductor counts from the upstream protection's pole
configuration (for example, a 3-phase feed entering a 2-pole protection becomes a
single-phase L+N wire in a `3N~` installation).

Circuit trunk devices may optionally contain a `placements` array using the same
situation-plan placement shape as endpoint placements. This supports physical
trunk-mounted devices such as transformers, rectifiers, inverters, and DC-DC
converters. A missing array remains valid and means that the device has no
situation-plan instance.

Ground-trunk earthing separators are physical pairs. Each paired separator record may
carry the same optional `earthingSeparatorPairId`; editors select and delete the pair
as one item. Older files without this field remain valid: consecutive unpaired
earthing separators are interpreted as legacy pairs.

When an older project contains a circuit endpoint or circuit trunk device with
symbol `junction_box` and no placement, the editor creates a visible placement
while loading. This compatibility repair uses the circuit's known floor when
possible and otherwise falls back to the project's first floor.

Situation-plan placement is optional for transformers, rectifiers, inverters,
DC-DC converters, solar panels, and batteries. Their absence is not a project
integrity error. When loading older conversion devices without placements, the
editor creates visible placements. Conversion placements stored as hidden by an
older editor version are automatically made visible while loading.

A supply-trunk inverter, battery, or solar-panel device may contain an ordered
`serialNumbers` array in its device-specific properties. The array maps one-to-one to
the device's ordered situation-plan placements and represents multiple physical units
rendered as one multiplied symbol in the one-wire view. A missing array keeps the
legacy single-unit `serialNumber` behavior. Readers must preserve placement and serial
ordering together when adding or removing units. Inverter unit arrays live in
`conversionProps`; battery and solar arrays live in `batteryProps` and
`solarPanelProps`. Per-unit inverter AC phase ordering must remain aligned as well.
Supported supply-inverter unit counts are one, two, and three; battery and solar groups
may contain up to 99 units.

Supply-trunk devices on a hybrid inverter's secondary DC branch use
`supplyPath: "converter-dc-top"`; the original right-hand DC chain continues to use
`"converter-dc"`. Devices within either branch remain ordered by their position in the
owning supply trunk array.

Situation-plan placements store their orientation in `rotationDeg` as clockwise degrees.
User rotation commands use quarter-turns (`0`, `90`, `180`, or `270`); automatic
orientation beside a drawn curved wall may store an intermediate angle matching the
wall normal at that point. A placement with `rotationMode: "explicit"` was rotated by
the user and must not be auto-oriented to nearby walls. Missing `rotationMode` is
backward-compatible and leaves auto-orientation available for symbol kinds that support
it; a missing or invalid legacy angle is read as zero.

Situation-plan wall elements may optionally contain a `curve` property with
`kind: "rationalQuadratic"` and a positive numeric `weight`. A curved wall stores
exactly three geometry points in start, control, end order. The weight
`0.7071067811865476` produces an exact quarter circle when the two control legs are
equal and perpendicular. Missing curve metadata means the wall points form an ordinary
polyline. Doors, windows, and bare openings must not reference a curved wall.

Panels may optionally contain `busbarPhases`. Its `main` array stores the repeating
`L1`/`L2`/`L3` order for the panel's main busbar. Its `secondary` object stores an
independent repeating order keyed by the stable id of the grouping protection or parent
circuit that owns that secondary busbar. Missing or invalid orders use `L1`, `L2`, `L3`.
Each busbar restarts its own sequence. In `3N~`, two-pole slots derive `L1+N`, `L2+N`,
and `L3+N`. In `3~`, the order applies per physical pole: each two-pole device consumes
two consecutive positions, producing `L1-L2`, `L3-L1`, `L2-L3`, then repeating for the
default order. Devices with more poles follow the same rule: they start at the current
pole offset, list consecutive phases in that order, and advance the offset by their pole
count (for example `2P, 3P, 2P` produces `L1-L2`, `L3-L1-L2`, `L3-L1`).

Panels may optionally contain `busSections`, representing independently supplied
top-level busbar sections inside one physical panel. `primaryBusSectionId` identifies
the default section for legacy or unassigned top-level devices. Top-level protections
and unprotected circuits may reference a section through `busSectionId`; circuits
below a protection inherit the protection's section. A section's optional `role`
(`normal`, `backup`, or `custom`) is a presentation hint only. Its optional
`phaseOrder` controls independent automatic phase sequencing and may contain a single
line phase for a single-phase bus in a multi-phase installation. Missing
`busSections` retains the historical single main bus and does not add persisted
placeholder data.

A root feed may optionally target one explicit bus section through `busSectionId`.
A supply-assembly attachment or load handoff may use `panel-bus-input` with `panelId`
and `busSectionId`. The existing `panel-input` attachment remains accepted and means
the panel's primary or implicit legacy bus. Incoming source capability and conductor
availability are derived from the targeted feed or handoff; the bus section's display
role must not be interpreted as electrical source truth. Multiple uncoordinated
incoming supplies to the same explicit section are invalid.

Phase choices are filtered by the installation's nominal voltage system: `3~` exposes
only `L1`, `L2`, and `L3` combinations and never `N`. The phase assignment controls are
hidden for `2~` (2×230 V), where there is no user-facing phase identity.

Each `feedTopology.rootFeeds[]` record may optionally contain `phaseAssignment` and
`showPhaseLabel` for the private, panel-side supply section. These fields are scoped by
`panelId`; they never narrow the shared utility-side feed or another main panel. A
reduced-pole protection on that root feed determines and locks the effective incoming
phase set after the protection. That lock overrides incompatible stored choices and is
inherited by the panel busbar, all circuits in the panel, and their downstream panel
chains. Missing fields remain a full-phase incoming supply for backward compatibility.
The same root-feed record may contain a `wireSections` map keyed by a stable physical
run identifier. Each value stores the cable, installation method, route, label
visibility, fire-class visibility, and optional length for one uninterrupted run
between supply devices or terminals. Orthogonal drawing pieces around a corner share
one key; a protection or other inline device starts a new run. Missing `wireSections`
keeps the role-level main-supply defaults used by older projects.

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

| Limit          |   Value |
| -------------- | ------: |
| `project.json` | 160 MiB |

Archive producers should stay comfortably below these limits. Consumers must not trust paths, MIME types, dimensions, identifiers, or JSON properties merely because they appear in an archive.

## Change policy

Format changes must be forward-migratable and preserve existing local projects. A meaningful change includes adding or moving persisted fields, changing required defaults, changing asset-path behavior, accepting or rejecting a schema version, modifying archive entries used for loading, or changing an import limit.

Every such change must update this document and add or adjust community archive round-trip tests or the relevant migration tests.
