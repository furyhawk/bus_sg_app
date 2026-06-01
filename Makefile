ENGINE ?= docker
COMPOSE_FILE ?= compose.yaml

ifeq ($(ENGINE),docker)
COMPOSE_CMD = docker compose
else ifeq ($(ENGINE),podman)
COMPOSE_CMD = podman compose
else
$(error Unsupported ENGINE='$(ENGINE)'. Use ENGINE=docker or ENGINE=podman)
endif

.PHONY: help build up down restart logs ps config pull

help:
	@echo "Usage: make <target> [ENGINE=docker|podman]"
	@echo "Targets: build up down restart logs ps config pull"

build:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) build

up:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) up -d --build

down:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) down

restart: down up

logs:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) logs -f app

ps:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) ps

config:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) config

pull:
	$(COMPOSE_CMD) -f $(COMPOSE_FILE) pull
