# Condui Community

> Publication draft. Condui Community is not published yet. A licence must be selected and the
> licensing section below must be completed before this repository is made public.

Condui Community is the local, self-hosted edition of Condui, a tool for creating and maintaining
Belgian electrical installation diagrams. It is intended for people who want to keep their project
files and working environment under their own control.

The Community edition works without sign-in or a managed Condui service. Projects are stored in the
browser on the device running the application and can be downloaded as portable project archives.
These archives are fully compatible in both directions with the hosted, paid Condui edition: the
same project can be opened and edited in either edition and moved between them without conversion.

## What you can do

Condui Community includes the local editing workflow:

- create and edit one-wire diagrams;
- create and edit situation plans and panel layouts;
- store projects locally in the browser;
- import and download portable Condui project archives;
- import supported plan files using the bundled local conversion service;
- export finished diagrams to PDF; and
- open the included demo project without saving changes to your project list.

The interface is available in Dutch, French, and English.

## What is different from the hosted Condui product

Condui Community is deliberately local. Managed storage, synchronization, multi-user collaboration,
sharing, server-backed project history, and hosted integrations are not included.

PDF exports contain the rendered document only. They do not contain an embedded editable Condui
project. Download and back up the project archive separately if you want to edit the project later.

Community installations are operated by the person or organization running them. There is no managed
backup, uptime guarantee, automatic server maintenance, or data recovery service.

## Run as a container

The supplied `Dockerfile` builds a standard OCI-compatible Linux container image. Docker is the
simplest tested way to run a production-style local instance:

```bash
docker compose up --build
```

Open <http://localhost:8080> after the container has started. Stop it with:

```bash
docker compose down
```

Other OCI-compatible tools can use the same image definition. For example, with Podman:

```bash
podman build -t condui-community:local .
podman run --rm -p 8080:8080 condui-community:local
```

The container serves the application and the local file-conversion endpoints it needs. It does not
require a database or a separate backend service.

## Run from source

Condui Community requires Node.js 24 and npm.

```bash
npm install
npm run build
npm start
```

Then open <http://localhost:8080>.

This repository is generated from Condui's private development repository. Generated Community
snapshots contain only the source and assets required by the local edition.

## Project data and backups

Projects created in the application are stored in the browser profile used to open Condui Community.
Clearing browser data, deleting that profile, or losing the device can remove locally stored projects.

Use the project download function regularly and keep the resulting archive somewhere you back up.
The portable archive is the editable source of the project. The PDF is an output document, not a
replacement for that archive.

The archive structure and compatibility expectations are documented in
[`docs/project-file-format.md`](docs/project-file-format.md).

## Updates

Pull the latest source and rebuild the image to update a self-hosted installation:

```bash
git pull
docker compose up --build -d
```

Back up important project archives before updating. Compatibility with supported project archives is
maintained through the documented import and migration path, but keeping your own backups remains
important.

## Licence and permitted use

**The publication licence has not been selected yet. Do not publish this repository until a `LICENSE`
file has been added.**

The final `LICENSE` file, not this README, will determine whether personal use, professional use,
modification, redistribution, commercial use, or offering a hosted service is permitted. Any short
plain-language summary added here later must remain subordinate to that licence.

Until a public licence is added, this draft and the private source repository remain all rights
reserved and do not grant permission to copy, redistribute, or use the source.

The Condui name and visual identity are separate from the source-code licence. Any trademark policy
will be documented before publication.

## Contributions and support

Contribution and support processes will be documented when the Community repository is published.
For now, use the private Condui development workflow for testing and review.

Condui Community can assist with drawing and documenting an installation, but it does not guarantee
regulatory compliance or acceptance by an inspection body. The installer and project owner remain
responsible for the installation and its documentation.
