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

BUILDDIR = build
CONFIG = _config.yml
VERSION = $(shell python version.py $(CONFIG))
DIST = $(NAME)-$(VERSION)

.SECONDARY:
.ONESHELL:
.PHONY: all

all: $(NAME).otf

export SOURCE_DATE_EPOCH=0

$(BUILDDIR)/%.otf: $(NAME).glyphs $(CONFIG)
	$(info   BUILD  $(*F))
	mkdir -p $(BUILDDIR)
	python build.py $< $(VERSION) $@

$(BUILDDIR)/%.subr.cff: $(BUILDDIR)/%.otf
	$(info   SUBR   $(*F))
	tx -cff2 +S +b $< $@ 2>/dev/null

%.otf: $(BUILDDIR)/%.subr.cff $(BUILDDIR)/%.otf
	sfntedit -d post -a CFF2=$+ $@
