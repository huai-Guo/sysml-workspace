# SysML Validator

This directory contains the deterministic, headless SysML v2 validator introduced in Phase 1 and used by the Phase 3 workflow.

## Platform support

This iteration is verified on Windows with Java 21 and Python 3.12. Linux and
macOS support is deferred to a later iteration; their Bash bootstrap and smoke
scripts are not part of the current support guarantee.

## Canonical validator

Pinned upstream:

- repository: Systems-Modeling/SysML-v2-Pilot-Implementation
- tag: 2026-08
- commit: 692170b71867353b8f90341e61556f49a5beb0e5
- Pilot version: 0.62.0
- Java: 21
- official release asset: jupyter-sysml-kernel-0.62.0.zip
- release SHA256: 5a015ed3f2b3d2dae14e9c3fb9602d9e1fef5f9ce33cf396c422329405cc3cb2

The release ZIP is used only as the official prebuilt binary carrier. The runtime does not launch Jupyter.

## Runtime path

~~~text
official release ZIP
    |
    +--> shaded Java JAR
    +--> sysml.library
            |
            v
SysMLInteractive.process(source, false)
    |
    +--> Xtext parsing/post-processing
    |
    +--> IResourceValidator.validate(..., CheckMode.ALL, ...)
    |
    v
SysMLInteractiveResult
    |
    v
normalized JSON diagnostics
~~~

No Eclipse UI, Maven build, or Jupyter frontend is required in the validator runtime path.

## Why use the Jupyter release ZIP?

The Pilot project already publishes a self-contained shaded JAR plus the official SysML libraries in that bundle. Rebuilding the full Tycho/Eclipse project inside sysml-agent adds unrelated build complexity.

We therefore:

1. download the official 2026-08 release asset;
2. verify its published SHA256;
3. compile only our tiny adapter against the shaded JAR;
4. invoke SysMLInteractive directly.

Jupyter is packaging provenance, not an architectural dependency.

## Bootstrap

Windows PowerShell:

~~~powershell
.\tooling\sysml-validator\bootstrap.ps1
~~~

Use `-Force` to redownload the pinned release.

## Validate

Windows:

~~~powershell
.\tooling\sysml-validator\validate.ps1 .\model.sysml
~~~

The adapter writes one JSON object to stdout.

The machine-readable contract is documented in:

~~~text
tooling/sysml-validator/diagnostic.schema.json
~~~

## Official example candidates

[`fixtures/official-examples-manifest.json`](fixtures/official-examples-manifest.json)
records candidate examples from the pinned SysML v2 Release repository, with
source hashes and dependency notes. These are not admitted regression fixtures:
their `admissionStatus` remains `pending_validation` until the exact source is
checked against the pinned Pilot validator and library, and the validation
result is reviewed. Multi-file projects remain deferred until project input is
supported.

Exit codes:

- 0: valid SysML; warnings may still be present.
- 1: SysML contains validation errors.
- 2: adapter, argument, bootstrap or internal failure.

## Smoke tests

Frozen fixtures cover:

1. known-valid SysML;
2. syntax-invalid SysML;
3. semantic-invalid SysML with an unresolved type.

Windows:

~~~powershell
.\tooling\sysml-validator\smoke-test.ps1
~~~

## Validator acceptance criteria

Phase 1 is accepted when CI proves:

- Java 21 can load the pinned official Pilot release;
- the valid fixture exits 0 and reports valid=true;
- the syntax fixture exits 1 and contains a syntax diagnostic;
- the semantic fixture exits 1 and contains a semantic diagnostic;
- diagnostics are machine-readable JSON;
- no Eclipse or Jupyter UI is needed.

The ModelGateway and workflow live in `src/sysml_agent`; this directory owns
only deterministic validation and its pinned upstream runtime.
