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

CONFIG = _config.yml
VERSION = $(shell python version.py $(CONFIG))
DIST = $(NAME)-$(VERSION)

ARGS ?= 

.PHONY: all

all: $(NAME).otf

%.otf: $(NAME).glyphs $(CONFIG)
	$(info   BUILD  $(*F))
	python build.py $< $(VERSION) $@ $(ARGS)
