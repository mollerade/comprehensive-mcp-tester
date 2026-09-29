# Developer tasks and the install contract for MCP Tester.
# Wraps the npm scripts so the usual targets work by convention; package.json
# stays the source of truth for what each one runs.
#
#   make               build dist/ (same as make build)
#   make check         everything CI's test job checks, offline
#   make install       install the local server as the `mcp-tester` command
#
# install and uninstall honour PREFIX (default /usr/local), BINDIR, LIBDIR
# and DESTDIR (for staged installs: files go under DESTDIR, but the installed
# command still points at PREFIX). Portable to GNU Make 3.81 (macOS).

PREFIX ?= /usr/local
BINDIR ?= $(PREFIX)/bin
LIBDIR ?= $(PREFIX)/lib/mcp-tester
NPM ?= npm

.PHONY: all help deps build test trace readme check lint dev start mock clean install uninstall

all: build

help:
	@echo "make build      regenerate dist/ (index.html, worker.js, worker.mjs)"
	@echo "make test       every test suite"
	@echo "make trace      every acceptance criterion has a test"
	@echo "make readme     README structure check"
	@echo "make check      test + trace + readme + build: the offline CI gate"
	@echo "make lint       markdownlint and codespell (fetches markdownlint-cli2 with npx)"
	@echo "make dev        local server that restarts on changes"
	@echo "make start      local server on http://127.0.0.1:8787"
	@echo "make mock       mock MCP server on http://127.0.0.1:8788/mcp"
	@echo "make clean      remove dist/"
	@echo "make install    install the mcp-tester command (PREFIX=$(PREFIX))"
	@echo "make uninstall  remove it again"

node_modules: package.json package-lock.json
	@$(NPM) ci
	@touch node_modules

deps: node_modules

build:
	@$(NPM) run build

test: node_modules
	@$(NPM) test

trace:
	@$(NPM) run test:trace

readme:
	@$(NPM) run check:readme

check: test trace readme build

lint: readme
	@npx --yes markdownlint-cli2 "**/*.md"
	@if command -v codespell >/dev/null 2>&1; then codespell; else echo "codespell not installed (pip install codespell); spelling not checked"; fi

dev:
	@$(NPM) run dev

start:
	@$(NPM) start

mock:
	@$(NPM) run mock

clean:
	@rm -rf dist

# The server runs from its own directory with no runtime dependencies, so
# installing is copying src/ and package.json (for "type": "module"). The
# command is a wrapper, not a symlink: the server only starts when node is
# given its real path.
install:
	@install -d "$(DESTDIR)$(LIBDIR)" "$(DESTDIR)$(BINDIR)"
	@rm -rf "$(DESTDIR)$(LIBDIR)/src"
	@cp -R src package.json "$(DESTDIR)$(LIBDIR)/"
	@find "$(DESTDIR)$(LIBDIR)" -name .DS_Store -exec rm -f {} +
	@printf '#!/bin/sh\nexec node "%s/src/hosts/node-server.js" "$$@"\n' "$(LIBDIR)" > "$(DESTDIR)$(BINDIR)/mcp-tester"
	@chmod 755 "$(DESTDIR)$(BINDIR)/mcp-tester"
	@echo "installed $(DESTDIR)$(BINDIR)/mcp-tester"

uninstall:
	@rm -f "$(DESTDIR)$(BINDIR)/mcp-tester"
	@rm -rf "$(DESTDIR)$(LIBDIR)"
	@echo "removed $(DESTDIR)$(BINDIR)/mcp-tester and $(DESTDIR)$(LIBDIR)"
