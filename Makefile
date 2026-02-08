.PHONY: all test test-race bench lint react-test react-build clean

all: test react-test

# ─── Go CLI ────────────────────────────────────────────────────

test:
	cd cli && go test ./... -count=1

test-race:
	cd cli && go test -race ./... -count=1

bench:
	cd cli && go test ./internal/thumbhash/ -bench=. -benchmem -count=3 -benchtime=2s

lint:
	cd cli && go vet ./...

# ─── React runtime ────────────────────────────────────────────

react-test:
	cd packages/react && npx vitest run

react-build:
	cd packages/react && npx tsup src/index.ts --format esm --minify --dts

react-size: react-build
	@echo "── bundle size ──"
	@ls -l packages/react/dist/index.js
	@echo -n "gzip: " && gzip -c packages/react/dist/index.js | wc -c | tr -d ' '

# ─── E2E smoke test ───────────────────────────────────────────

e2e:
	bash e2e/smoke_test.sh

# ─── CI (run both Go race + React + E2E) ─────────────────────

ci: test-race react-test lint e2e
	@echo "✓ CI passed"

clean:
	rm -rf cli/tgimg packages/react/dist demo/dist e2e/_out e2e/fixtures
