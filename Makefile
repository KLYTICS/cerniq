# AEGIS — top-level dev orchestrator.
#
# Goal: clone -> `make dev` -> postgres + redis up, migrations applied,
# demo data seeded, API on :3000, dashboard on :3001, in under 60 seconds.
#
# CLI-specific targets live in Makefile.cli (do not merge here without
# operator approval; parallel sessions hold claims on that file).
#
# Portability: works with BSD make (macOS) and GNU make (Linux). Avoid
# GNU-isms (no $(shell ... 2> /dev/null || true) tricks beyond what BSD
# supports; no .ONESHELL; no pattern-substitution functions).

SHELL := /usr/bin/env bash

# Default goal — `make` with no args prints help.
.DEFAULT_GOAL := help

API_URL ?= http://localhost:3000

.PHONY: help install up migrate seed dev test typecheck preflight preflight-fast preflight-prod doctor clean down nuke health \
        _check-pnpm _check-docker

# ---------------------------------------------------------------------------
# help — auto-generated from `## ` comments next to each target.
# ---------------------------------------------------------------------------

help:  ## show this help
	@printf "AEGIS dev orchestrator\n\n"
	@printf "Usage: make <target>\n\n"
	@printf "Targets:\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| grep -v '^_' \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s  %s\n", $$1, $$2}'
	@printf "\nFirst time? Run: make dev\n"

# ---------------------------------------------------------------------------
# Prerequisite checks (private targets, prefixed with _).
# ---------------------------------------------------------------------------

_check-pnpm:
	@command -v pnpm >/dev/null 2>&1 || { \
		echo "make: pnpm not found on PATH."; \
		echo "      install: https://pnpm.io/installation"; \
		exit 1; \
	}

_check-docker:
	@command -v docker >/dev/null 2>&1 || { \
		echo "make: docker not found on PATH."; \
		echo "      install Docker Desktop: https://www.docker.com/products/docker-desktop/"; \
		exit 1; \
	}

# ---------------------------------------------------------------------------
# install — workspace install. Required before anything that runs TS.
# ---------------------------------------------------------------------------

install: _check-pnpm  ## pnpm install across the workspace
	pnpm install -r

# ---------------------------------------------------------------------------
# up — start postgres + redis, wait for healthy. Delegates to script.
# ---------------------------------------------------------------------------

up: _check-docker  ## start postgres + redis (idempotent, waits for healthy)
	@bash scripts/dev-up.sh

# ---------------------------------------------------------------------------
# migrate — apply pending Prisma migrations against DATABASE_URL.
# ---------------------------------------------------------------------------

migrate: _check-pnpm  ## apply Prisma migrations (requires DATABASE_URL)
	@if [[ -z "$${DATABASE_URL:-}" ]]; then \
		echo "make migrate: DATABASE_URL is unset."; \
		echo "             defaulting to local docker-compose Postgres."; \
		export DATABASE_URL="postgresql://aegis:aegis@localhost:5432/aegis?schema=public"; \
		pnpm --filter @aegis/api exec prisma migrate deploy; \
	else \
		pnpm --filter @aegis/api exec prisma migrate deploy; \
	fi

# ---------------------------------------------------------------------------
# seed — load round-14 demo dataset. Soft-skip if the script is not present
# (the round-14 lane delivers it; we don't want to block `make dev` on it).
# ---------------------------------------------------------------------------

seed: _check-pnpm  ## load demo data (round-14 seed; soft-skips if absent)
	@if pnpm --filter @aegis/scripts run --if-present seed:demo >/dev/null 2>&1; then \
		pnpm --filter @aegis/scripts seed:demo; \
	else \
		echo "make seed: round-14 demo seed not yet present, skipping."; \
	fi

# ---------------------------------------------------------------------------
# dev — the from-clone-to-running command. Composite target.
# ---------------------------------------------------------------------------

dev: _check-pnpm _check-docker install up migrate seed  ## full bring-up: install + up + migrate + seed + run API & dashboard
	@echo ""
	@echo "make dev: stack ready. Starting API (:3000) and dashboard (:3001)..."
	@echo "          ctrl-c to stop both."
	@echo ""
	pnpm -r --parallel dev

# ---------------------------------------------------------------------------
# test, typecheck — CI-friendly checks.
# ---------------------------------------------------------------------------

test: _check-pnpm  ## run all workspace tests
	pnpm -r test

typecheck: _check-pnpm  ## run tsc --noEmit across the workspace
	pnpm -r exec tsc --noEmit

# ---------------------------------------------------------------------------
# preflight — single ship-readiness gate. See tools/preflight/README.md.
# Exit 0 ship · 1 warn · 2 do-not-ship · 3 internal error.
# Pass extra args via ARGS, e.g. `make preflight ARGS="--prod"`.
# ---------------------------------------------------------------------------

preflight: _check-pnpm  ## ship-readiness gate (full run; pass ARGS=--fast or ARGS=--prod)
	@pnpm -F @aegis/api exec tsx $(CURDIR)/tools/preflight/preflight.ts $(ARGS)

preflight-fast: _check-pnpm  ## fast subset (no vitest); for pre-commit
	@pnpm -F @aegis/api exec tsx $(CURDIR)/tools/preflight/preflight.ts --fast

preflight-prod: _check-pnpm  ## production gate — fails on missing prod env vars
	@pnpm -F @aegis/api exec tsx $(CURDIR)/tools/preflight/preflight.ts --prod

# ---------------------------------------------------------------------------
# doctor — diagnose the developer's machine. Different from preflight (branch
# shippability) and health (running stack). Doctor answers "is THIS machine
# ready to run AEGIS locally?" — the question on first clone.
# Exit 0 green · 1 yellow (warnings) · 2 red (blockers).
# ---------------------------------------------------------------------------

doctor:  ## diagnose dev environment (node/pnpm/docker/ports/.env/deps)
	@bash $(CURDIR)/scripts/doctor.sh

# ---------------------------------------------------------------------------
# clean — nuke local build output + node_modules. Confirms before running.
# ---------------------------------------------------------------------------

clean:  ## remove node_modules, dist, .turbo, .next (asks for confirmation)
	@read -r -p "Confirm clean (yes): " ans; \
	if [[ "$$ans" != "yes" ]]; then echo "make clean: aborted."; exit 1; fi; \
	echo "make clean: stopping containers..."; \
	(docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true); \
	echo "make clean: removing build artifacts..."; \
	find . -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	find . -name dist        -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	find . -name .turbo      -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	find . -name .next       -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	echo "make clean: done."

# ---------------------------------------------------------------------------
# down — stop docker containers, preserve volumes.
# ---------------------------------------------------------------------------

down: _check-docker  ## stop docker containers (preserves volumes)
	@(docker compose down 2>/dev/null || docker-compose down)

# ---------------------------------------------------------------------------
# nuke — destructive: drop volumes + clean. Requires confirmation.
# ---------------------------------------------------------------------------

nuke: _check-docker  ## DESTRUCTIVE: drop docker volumes + clean (asks for confirmation)
	@read -r -p "Confirm nuke (this drops Postgres data) (yes): " ans; \
	if [[ "$$ans" != "yes" ]]; then echo "make nuke: aborted."; exit 1; fi; \
	echo "make nuke: dropping docker volumes..."; \
	(docker compose down -v 2>/dev/null || docker-compose down -v); \
	echo "make nuke: cleaning local artifacts..."; \
	find . -name node_modules -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	find . -name dist        -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	find . -name .turbo      -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	find . -name .next       -type d -prune -exec rm -rf {} + 2>/dev/null || true; \
	echo "make nuke: done."

# ---------------------------------------------------------------------------
# health — sanity check after `make dev`.
# ---------------------------------------------------------------------------

health:  ## curl /health/ready against the API and pretty-print
	@command -v curl >/dev/null 2>&1 || { echo "make health: curl not found."; exit 1; }
	@echo "GET $(API_URL)/health/ready"
	@if command -v jq >/dev/null 2>&1; then \
		curl -fsS "$(API_URL)/health/ready" | jq .; \
	else \
		curl -fsS "$(API_URL)/health/ready"; echo; \
	fi
