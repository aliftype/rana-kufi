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

SHELL = bash
MAKEFLAGS := -srj
PYTHON := venv/bin/python3

SOURCEDIR = sources
SCRIPTDIR = scripts
FONTDIR = fonts
TESTDIR = tests
BUILDDIR = build

FONT = ${FONTDIR}/${NAME}.otf

GLYPHSFILE = ${SOURCEDIR}/${NAME}.glyphspackage

export SOURCE_DATE_EPOCH ?= $(shell stat -c "%Y" ${GLYPHSFILE})

TAG = $(shell git describe --tags --abbrev=0)
VERSION = ${TAG:v%=%}
DIST = ${NAME}-${VERSION}


.SECONDARY:
.ONESHELL:
.PHONY: all clean dist ttf

all: ttf
ttf: ${FONT}

${BUILDDIR}/%.glyphs: ${SOURCEDIR}/%.glyphspackage
	$(info   PREP   ${@F})
	mkdir -p ${BUILDDIR}
	${PYTHON} ${SCRIPTDIR}/prepare.py $< ${VERSION} $@

${FONT}: ${BUILDDIR}/${NAME}.glyphs
	$(info   BUILD  ${@F})
	${PYTHON} -m fontmake $< \
			      --output-path=$@ \
			      --output=variable-cff2 \
			      --verbose=WARNING \
			      --filter ... \
			      --filter "alifTools.filters::ClearPlaceholdersFilter()" \
			      --filter "alifTools.filters::FontVersionFilter(fontVersion=${VERSION})"

dist: ${FONT}
	$(info   DIST   ${DIST}.zip)
	install -Dm644 -t ${DIST} ${FONT}
	install -Dm644 -t ${DIST} {README,README-Arabic}.txt
	install -Dm644 -t ${DIST} OFL.txt
	zip -rq ${DIST}.zip ${DIST}

clean:
	rm -rf ${BUILDDIR} ${FONT} ${SVG} ${DIST} ${DIST}.zip
