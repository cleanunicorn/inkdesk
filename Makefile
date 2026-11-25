.DEFAULT_GOAL := help

.PHONY: help install dev test build preview

help:
	@echo "make install  Install dependencies from package-lock.json"
	@echo "make dev      Start the development server with hot reload"
	@echo "make test     Run all tests"
	@echo "make build    Build the production app in dist/"
	@echo "make preview  Preview the production build"

install:
	npm ci

dev:
	npm run dev

test:
	npm test

build:
	npm run build

preview:
	npm run preview -- --host 0.0.0.0
