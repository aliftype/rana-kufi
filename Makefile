# Copyright (c) 2020 Khaled Hosny
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

NAME = RanaKufi

MAKEFLAGS := -sr
SHELL = bash
ARGS ?= 

CONFIG = docs/_config.yml
VERSION = $(shell grep "version:" $(CONFIG) | sed -e 's/.*.: "\(.*.\)".*/\1/')
DIST = $(NAME)-$(VERSION)

SOURCEDIR = sources
SCRIPTDIR = scripts
FONTDIR = fonts
TESTDIR = tests
BUILDDIR = build

FONTS = $(FONTDIR)/$(NAME).otf
WOFF2 = $(FONTDIR)/$(NAME).woff2

.SECONDARY:
.ONESHELL:
.PHONY: all dist

all: ttf web
ttf: $(FONTS)

web: $(WOFF2)
	cp $(WOFF2) docs/assets/fonts/
	cp $(FONTS) docs/app/assets/fonts/

%.otf: $(SOURCEDIR)/$(NAME).glyphspackage $(CONFIG)
	$(info   BUILD  $(*F))
	python $(SCRIPTDIR)/build.py $< $(VERSION) $@ $(ARGS)

%.woff2: %.otf
	$(info   WOFF2  $(@F))
	python $(SCRIPTDIR)/buildwoff2.py $< $@

dist: all
	$(info   DIST   $(DIST).zip)
	install -Dm644 -t $(DIST) $(FONTS)
	install -Dm644 -t $(DIST) {README,README-Arabic}.txt
	install -Dm644 -t $(DIST) LICENSE
	zip -rq $(DIST).zip $(DIST)
