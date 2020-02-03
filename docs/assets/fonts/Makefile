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

.ONESHELL:

all: RanaKufi.otf RanaKufi.ttx

RanaKufi.otf: RanaKufi.glyphs build.py
	@. env/bin/activate
	@export SOURCE_DATE_EPOCH=0
	@python build.py $< $@
	@echo " SUBR	$@"
	@tx -cff2 +S +b $@ cff2 &>/dev/null
	@sfntedit -a CFF2=cff2 -d post $@
	@rm cff2

%.ttx: %.otf
	@. env/bin/activate
	@echo " TTX	$@"
	@ttx -q -o $@ $<
